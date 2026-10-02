/**
 * The way back to the wall panel.
 *
 * The Home Assistant panel on the wall screen opens Odín with
 * `?volver=<panel url>`. Only then is there a button, bottom left, that closes
 * this tab (the panel’s is still underneath) or, if the browser won't let a
 * page close itself, goes back to the panel.
 */

const volver = (() => {
  try {
    const url = new URL(new URLSearchParams(location.search).get('volver') ?? '')
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
})()

export function Volver() {
  if (!volver) return null
  const back = () => {
    window.close()
    setTimeout(() => location.assign(volver), 150)
  }
  return (
    <button className="volver" onClick={back}>
      ← CASA
    </button>
  )
}
