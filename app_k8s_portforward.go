package main

import "github.com/ys-ll/uniterm/backend/k8s"

func (a *App) K8sStartPortForward(connID, namespace, pod string, localPort, remotePort int) (k8s.PortForwardInfo,error) {
	return a.k8sManager.StartPortForward(connID,namespace,pod,localPort,remotePort)
}
func (a *App) K8sStopPortForward(connID,id string) { a.k8sManager.StopPortForward(connID,id) }
func (a *App) K8sListPortForwards(connID string) []k8s.PortForwardInfo { return a.k8sManager.ListPortForwards(connID) }
