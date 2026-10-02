import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * The `apps_*` tools — small everyday reaches into the computer ODIN runs on:
 * open the mail, find and play something on YouTube, and write or read notes.
 *
 * Everything opens on this machine, in the default browser. Notes go to Apple
 * Notes on a Mac (folder "Odín", so they sync to the iPhone through iCloud) and
 * to Markdown files under Documents\Notas de Odín everywhere else.
 */

const MAIL_URL = () => process.env.MAIL_URL ?? 'https://mail.google.com/mail/u/0/#inbox'
const NOTES_FOLDER = 'Odín'

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()))
      else resolve(stdout.trim())
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

/** Open a URL in the default browser. No shell, so nothing in the URL is ever interpreted. */
export function openUrl(url) {
  if (process.platform === 'darwin') return run('open', [url])
  // rundll32 rather than `start`: cmd would treat the & in a query string as a command separator.
  if (process.platform === 'win32') return run('rundll32', ['url.dll,FileProtocolHandler', url])
  return run('xdg-open', [url])
}

// YouTube -----------------------------------------------------------------------

/** First video for a search, read from YouTube's own results page (no API key). */
async function firstVideo(query) {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
    headers: {
      'accept-language': 'es-ES,es;q=0.9',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      // Skips the EU consent interstitial, which otherwise replaces the results.
      cookie: 'SOCS=CAI; CONSENT=YES+1',
    },
    signal: AbortSignal.timeout(10_000),
  })
  const html = await res.text()
  const id = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1]
  if (!id) return null
  // The title sits a little after the first videoId in the same renderer.
  const after = html.slice(html.indexOf(id))
  const title = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(after)?.[1]
  return { id, title: title ? JSON.parse(`"${title}"`) : '' }
}

// Notes -------------------------------------------------------------------------

const notesDir = () => join(homedir(), 'Documents', 'Notas de Odín')
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80).trim() || 'Nota'
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const today = () => new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })

// AppleScript with the text passed as arguments, never spliced into the script.
const NOTES_LIB = `
on ensureFolder()
  tell application "Notes"
    if not (exists folder "${NOTES_FOLDER}") then make new folder with properties {name:"${NOTES_FOLDER}"}
    return folder "${NOTES_FOLDER}"
  end tell
end ensureFolder
`

async function macNoteAdd(title, html) {
  await run('osascript', ['-', title, html, escapeHtml(title)], `${NOTES_LIB}
on run argv
  set f to my ensureFolder()
  tell application "Notes"
    make new note at f with properties {name:(item 1 of argv), body:("<h1>" & (item 3 of argv) & "</h1>" & (item 2 of argv))}
  end tell
end run`)
}

async function macNoteAppend(title, html) {
  return run('osascript', ['-', title, html, escapeHtml(title)], `${NOTES_LIB}
on run argv
  set f to my ensureFolder()
  tell application "Notes"
    set hits to (notes of f whose name is (item 1 of argv))
    if (count of hits) is 0 then
      make new note at f with properties {name:(item 1 of argv), body:("<h1>" & (item 3 of argv) & "</h1>" & (item 2 of argv))}
      return "created"
    end if
    set n to item 1 of hits
    set body of n to (body of n) & (item 2 of argv)
    return "appended"
  end tell
end run`)
}

async function macNotesRead(query) {
  return run('osascript', ['-', query], `${NOTES_LIB}
on run argv
  set f to my ensureFolder()
  set q to item 1 of argv
  set out to {}
  tell application "Notes"
    repeat with n in (notes of f)
      if q is "" or (name of n) contains q or (plaintext of n) contains q then
        set end of out to (name of n) & ": " & (plaintext of n)
      end if
      if (count of out) ≥ 5 then exit repeat
    end repeat
  end tell
  set AppleScript's text item delimiters to linefeed & "---" & linefeed
  return out as text
end run`)
}

async function fileNoteAdd(title, text, append) {
  await mkdir(notesDir(), { recursive: true })
  const path = join(notesDir(), `${safeName(title)}.md`)
  let exists = true
  try {
    await readFile(path)
  } catch {
    exists = false
  }
  if (append && exists) await appendFile(path, `\n- ${text}  _(${today()})_\n`)
  else await writeFile(path, `# ${title}\n\n${text}\n\n_${today()}_\n`)
  return exists && append ? 'appended' : 'created'
}

async function fileNotesRead(query) {
  let names = []
  try {
    names = (await readdir(notesDir())).filter((n) => n.endsWith('.md'))
  } catch {
    return ''
  }
  const out = []
  const q = query.toLowerCase()
  for (const n of names) {
    const text = await readFile(join(notesDir(), n), 'utf8')
    if (!q || n.toLowerCase().includes(q) || text.toLowerCase().includes(q)) out.push(text.slice(0, 1500))
    if (out.length >= 5) break
  }
  return out.join('\n---\n')
}

// Tools -------------------------------------------------------------------------

const ok = (text) => ({ content: [{ type: 'text', text }] })
const fail = (e) => ({ content: [{ type: 'text', text: String(e?.message ?? e) }], isError: true })

const where = process.platform === 'darwin' ? 'Apple Notes, folder "Odín" (syncs to the iPhone)' : 'Documents\\Notas de Odín as Markdown files'

export function appsServer() {
  return createSdkMcpServer({
    name: 'jarvis_apps',
    version: '1.0.0',
    tools: [
      tool(
        'open_mail',
        'Open the user\'s email inbox in the browser on this computer. With a search, open the inbox filtered by it ("abre los correos de Amazon").',
        { search: z.string().optional() },
        async ({ search }) => {
          try {
            const base = MAIL_URL()
            const url = search && base.includes('mail.google.com')
              ? `${base.split('#')[0]}#search/${encodeURIComponent(search)}`
              : base
            await openUrl(url)
            return ok('Mail opened.')
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'youtube_play',
        'Find a video on YouTube and play it in the browser on this computer ("pon en YouTube el último vídeo de X", "ponme el tráiler de Dune"). Say the title of what you put on.',
        { query: z.string() },
        async ({ query }) => {
          try {
            const v = await firstVideo(query)
            if (!v) {
              await openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`)
              return ok('No single video found; opened the search results instead.')
            }
            await openUrl(`https://www.youtube.com/watch?v=${v.id}`)
            return ok(JSON.stringify({ playing: v.title || query }))
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'youtube_open',
        'Open YouTube in the browser on this computer: the home page, or a search results page if given a query ("busca en YouTube recetas de pasta").',
        { query: z.string().optional() },
        async ({ query }) => {
          try {
            await openUrl(query ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` : 'https://www.youtube.com')
            return ok('YouTube opened.')
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'notes_write',
        `Write in the user's notes (${where}). New note by default; with append: true, add a line to an existing note of that title (e.g. the shopping list, "Lista de la compra"), creating it if missing. Give every note a short Spanish title. Confirm in one line ("Anotado en la lista de la compra.").`,
        {
          title: z.string(),
          text: z.string(),
          append: z.boolean().optional(),
        },
        async ({ title, text, append }) => {
          try {
            if (process.platform === 'darwin') {
              const html = text.split('\n').map((l) => `<div>${escapeHtml(l)}</div>`).join('')
              const r = append ? await macNoteAppend(title, html) : (await macNoteAdd(title, html), 'created')
              return ok(r === 'appended' ? `Added to "${title}".` : `Note "${title}" created.`)
            }
            const r = await fileNoteAdd(title, text, append)
            return ok(r === 'appended' ? `Added to "${title}".` : `Note "${title}" created.`)
          } catch (e) {
            return fail(e)
          }
        },
      ),

      tool(
        'notes_read',
        `Read the user's notes written by ODIN (${where}). With a query, only notes whose title or text contain it ("¿qué tengo en la lista de la compra?").`,
        { query: z.string().optional() },
        async ({ query }) => {
          try {
            const text = process.platform === 'darwin' ? await macNotesRead(query ?? '') : await fileNotesRead(query ?? '')
            return ok(text || 'No notes found.')
          } catch (e) {
            return fail(e)
          }
        },
      ),
    ],
  })
}
