package k8s

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// PortForwardInfo contains listener state, not a claim that a remote service is reachable.
type PortForwardInfo struct {
	ID string `json:"id"`
	ConnID string `json:"connId"`
	Namespace string `json:"namespace"`
	Pod string `json:"pod"`
	LocalPort int `json:"localPort"`
	RemotePort int `json:"remotePort"`
	LastError string `json:"lastError"`
}
type portForwardHandle struct {
	info PortForwardInfo
	listener net.Listener
	cancel context.CancelFunc
	mu sync.Mutex
	lastError string
}
func (h *portForwardHandle) report(err error) {
	if err == nil { return }
	h.mu.Lock()
	h.lastError = err.Error()
	h.mu.Unlock()
}
func (m *Manager) StartPortForward(connID, ns, pod string, localPort, remotePort int) (PortForwardInfo, error) {
	if ns == "" || pod == "" || strings.ContainsAny(ns+pod, "/\\?#") || localPort < 0 || localPort > 65535 || remotePort < 1 || remotePort > 65535 {
		return PortForwardInfo{}, fmt.Errorf("invalid namespace, pod or port")
	}
	// Bind only loopback; remote cluster access is never exposed on LAN by default.
	ln, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(localPort)))
	if err != nil { return PortForwardInfo{}, err }
	ctx, cancel := context.WithCancel(context.Background())
	h := &portForwardHandle{info:PortForwardInfo{ID:uuid.NewString(),ConnID:connID,Namespace:ns,Pod:pod,LocalPort:ln.Addr().(*net.TCPAddr).Port,RemotePort:remotePort},listener:ln,cancel:cancel}
	m.mu.Lock()
	conn, ok := m.conns[connID]
	if !ok {
		m.mu.Unlock(); cancel(); ln.Close()
		return PortForwardInfo{}, fmt.Errorf("Kubernetes connection not found")
	}
	if m.forwards == nil { m.forwards = make(map[string]*portForwardHandle) }
	m.forwards[h.info.ID] = h
	m.mu.Unlock()
	go func() {
		defer func() { cancel(); ln.Close(); m.mu.Lock(); delete(m.forwards,h.info.ID); m.mu.Unlock() }()
		for {
			local, err := ln.Accept()
			if err != nil { return }
			go func() {
				defer local.Close()
				stop := context.AfterFunc(ctx, func(){ local.Close() })
				defer stop()
				if err := forwardPortConnection(ctx,conn,ns,pod,remotePort,local); err != nil && ctx.Err()==nil { h.report(err) }
			}()
		}
	}()
	return h.info,nil
}
func (m *Manager) StopPortForward(connID,id string) {
	m.mu.Lock()
	h := m.forwards[id]
	if h != nil && h.info.ConnID == connID { delete(m.forwards,id) } else { h=nil }
	m.mu.Unlock()
	if h != nil { h.cancel(); h.listener.Close() }
}
func (m *Manager) ListPortForwards(connID string) []PortForwardInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]PortForwardInfo,0)
	for _,h := range m.forwards {
		if h.info.ConnID != connID { continue }
		h.mu.Lock()
		info := h.info
		info.LastError = h.lastError
		h.mu.Unlock()
		out = append(out,info)
	}
	return out
}

// Legacy Kubernetes binary channel WebSocket protocol: one connection per local TCP stream,
// port prefix (little endian uint16) on the first message of each channel, data=0,error=1.
// Servers that only support SPDY tunneling will return an explicit upgrade error.
func forwardPortConnection(ctx context.Context, conn *connection, ns,pod string, port int, local net.Conn) error {
	u,err:=url.Parse(conn.base)
	if err!=nil{return err}
	if u.Scheme=="https"{u.Scheme="wss"}else{u.Scheme="ws"}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/v1/namespaces/"+ns+"/pods/"+pod+"/portforward"
	q:=url.Values{}
	q.Set("ports",strconv.Itoa(port))
	u.RawQuery=q.Encode()
	dialer:=websocket.Dialer{TLSClientConfig:conn.tlsConfig,Subprotocols:[]string{"v4.channel.k8s.io"},HandshakeTimeout:10*time.Second}
	if conn.dialOverride!=nil{dialer.NetDialContext=conn.dialOverride}else{dialer.Proxy=http.ProxyFromEnvironment}
	headers:=http.Header{}
	if conn.token!=""{headers.Set("Authorization","Bearer "+conn.token)}
	ws,resp,err:=dialer.DialContext(ctx,u.String(),headers)
	if err!=nil{if resp!=nil&&resp.Body!=nil{resp.Body.Close()};return fmt.Errorf("port-forward upgrade: %w",err)}
	defer ws.Close()
	if ws.Subprotocol()!="v4.channel.k8s.io"{return fmt.Errorf("unsupported port-forward WebSocket protocol")}
	stop:=context.AfterFunc(ctx,func(){ws.Close();local.Close()})
	defer stop()
	ws.SetReadLimit(16*1024*1024)
	done:=make(chan error,1)
	go func(){
		buf:=make([]byte,32769)
		for{
			n,e:=local.Read(buf[1:])
			if n>0{
				buf[0]=0
				ws.SetWriteDeadline(time.Now().Add(15*time.Second))
				if w:=ws.WriteMessage(websocket.BinaryMessage,buf[:n+1]);w!=nil{done<-w;ws.Close();return}
			}
			if e!=nil{done<-e;ws.Close();return}
		}
	}()
	var first [2]bool
	for{
		typ,msg,e:=ws.ReadMessage()
		if e!=nil{select{case w:=<-done:if w==io.EOF{return nil};return w;default:};if websocket.IsCloseError(e,websocket.CloseNormalClosure,websocket.CloseGoingAway){return nil};return e}
		if typ!=websocket.BinaryMessage || len(msg)==0{continue}
		channel:=msg[0]
		if channel>1{return fmt.Errorf("unexpected port-forward channel %d",channel)}
		data:=msg[1:]
		if !first[channel]{
			if len(data)<2||int(binary.LittleEndian.Uint16(data[:2]))!=port{return fmt.Errorf("invalid port-forward channel prefix")}
			first[channel]=true;data=data[2:]
		}
		if len(data)==0{continue}
		if channel==1{return fmt.Errorf("remote port-forward: %s",string(data))}
		if _,e=local.Write(data);e!=nil{return e}
	}
}
