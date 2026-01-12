import { exec } from 'child_process'
import { promisify } from 'util'

const execPromise = promisify(exec)

// Зверни увагу: замість 'module.exports' ми пишемо 'export async function'
export async function checkFFmpeg(customPath) {
  if (!customPath) return { ok: false, msg: 'Path is empty' }

  try {
    const { stdout } = await execPromise(`"${customPath}" -version`)
    const versionLine = stdout.split('\n')[0]
    return { ok: true, msg: `Ready: ${versionLine}` }
  } catch (error) {
    console.error('FFmpeg Check Error:', error.message)
    return {
      ok: false,
      msg: 'Error: Invalid executable or permission denied.'
    }
  }
}
