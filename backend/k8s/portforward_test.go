package k8s

import (
 "net"
 "strconv"
 "testing"
)

func TestPortForwardLoopbackLifecycle(t *testing.T) {
 m := NewManager()
 m.conns["test"] = &connection{id:"test",watches:map[string]struct{}{}}
 info,err := m.StartPortForward("test","ns","pod",0,8080)
 if err!=nil{t.Fatal(err)}
 if info.LocalPort==0{t.Fatal("expected allocated port")}
 if len(m.ListPortForwards("test"))!=1{t.Fatal("expected active listener")}
 if len(m.ListPortForwards("other"))!=0{t.Fatal("forward leaked across connection")}
 m.StopPortForward("other",info.ID)
 if len(m.ListPortForwards("test"))!=1{t.Fatal("other connection stopped listener")}
 m.Disconnect("test")
 if len(m.ListPortForwards("test"))!=0{t.Fatal("listener not removed")}
 ln,err:=net.Listen("tcp4",net.JoinHostPort("127.0.0.1",strconv.Itoa(info.LocalPort)))
 if err!=nil{t.Fatalf("listener not closed: %v",err)}
 ln.Close()
}

func TestPortForwardRejectsUnknownConnection(t *testing.T){
 m:=NewManager()
 if _,err:=m.StartPortForward("missing","ns","pod",0,8080);err==nil{t.Fatal("expected error")}
 if _,err:=m.StartPortForward("missing","ns","pod",0,0);err==nil{t.Fatal("expected invalid port error")}
}
