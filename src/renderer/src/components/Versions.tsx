import { useState } from 'react'

function Versions(): React.JSX.Element {
  const [versions] = useState(() => {
    // Note: process versions are no longer exposed via window.api
    // This component would need a new IPC channel if reactivated
    return { electron: '', chrome: '', node: '' }
  })

  return (
    <ul className="versions">
      <li className="electron-version">Electron v{versions.electron}</li>
      <li className="chrome-version">Chromium v{versions.chrome}</li>
      <li className="node-version">Node v{versions.node}</li>
    </ul>
  )
}

export default Versions
