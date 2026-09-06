import { contextBridge, ipcRenderer } from 'electron'
import { createDesktopApi } from './desktop-api'

contextBridge.exposeInMainWorld('kufar', createDesktopApi(ipcRenderer))
