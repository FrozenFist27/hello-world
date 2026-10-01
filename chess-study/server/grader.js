const os = require('os');
const { spawn } = require('child_process');

const CLAUDE_MODEL      = process.env.LEARNO_CLAUDE_MODEL || 'haiku';
const CLAUDE_TIMEOUT_MS = 90_000;
const GEMINI_MODEL      = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

class GraderError extends Error {
  constructor(message, { status = 502, setup = false } = {}) {
    super(message);
    this.status = status;
    this.setup  = setup;
  }
}

// A Gemini key is an explicit opt-in to the faster grader; without one, the
// learner's own Claude Code login does the grading.
function graderName() {
  const forced = (process.env.LEARNO_GRADER || '').toLowerCase();
  if (forced === 'claude' || forced === 'gemini') return forced;
  return process.env.GEMINI_API_KEY ? 'gemini' : 'claude';
}

function describeGrader() {
  return graderName() === 'claude'
    ? `Claude Code (${CLAUDE_MODEL}), through your claude login`
    : `Gemini (${GEMINI_MODEL})${process.env.GEMINI_API_KEY ? '' : '   ⚠ GEMINI_API_KEY not set'}`;
}

// Told to return bare JSON, models still wrap it in a ```json fence now and then.
function parseVerdict(text) {
  const body = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(body);
}

function gradeWithClaude(prompt) {
  return new Promise((resolve, reject) => {
    // No tools, no MCP servers, no user settings (so no hooks fire), and no saved
    // session: each answer would otherwise land in the learner's `claude --resume` list.
    const child = spawn('claude', [
      '-p',
      '--model', CLAUDE_MODEL,
      '--output-format', 'json',
      '--tools', '',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--no-session-persistence',
      '--system-prompt', 'You grade student answers. Reply with the JSON object only.'
    ], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new GraderError(`Claude Code did not answer within ${CLAUDE_TIMEOUT_MS / 1000}s`));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });

    child.on('error', e => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT'
        ? new GraderError('Claude Code (`claude`) is not on the server\'s PATH — install it, or set GEMINI_API_KEY in .env', { status: 503, setup: true })
        : e);
    });

    child.on('close', code => {
      clearTimeout(timer);

      let envelope;
      try {
        envelope = JSON.parse(out);
      } catch {
        return reject(new GraderError(`Claude Code exited with ${code}: ${(err || out).trim().slice(0, 200)}`));
      }

      if (envelope.is_error) {
        const detail = String(envelope.result || '');
        const setup  = /not logged in|\/login|authenticat/i.test(detail);
        return reject(new GraderError(
          setup ? 'Claude Code is not logged in — run `claude` once in a terminal and log in' : `Claude Code: ${detail}`,
          { status: setup ? 503 : 502, setup }));
      }

      try {
        resolve(parseVerdict(envelope.result));
      } catch {
        reject(new GraderError('Claude Code answered, but not with a verdict'));
      }
    });

    child.stdin.end(prompt);
  });
}

async function gradeWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new GraderError('GEMINI_API_KEY is not set — add it to .env, or unset LEARNO_GRADER to grade with Claude Code', { status: 503, setup: true });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('Gemini error:', res.status, detail);

    // A rejected key is a setup problem, not an outage.
    const badKey = res.status === 400 && /API key not valid/i.test(detail);
    throw new GraderError(
      badKey ? 'Gemini rejected the API key — check GEMINI_API_KEY in .env at the repo root' : `Gemini API error (${res.status})`,
      { status: badKey ? 503 : 502, setup: badKey });
  }

  const data = await res.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new GraderError('Empty response from Gemini');
  return parseVerdict(raw);
}

function grade(prompt) {
  return graderName() === 'claude' ? gradeWithClaude(prompt) : gradeWithGemini(prompt);
}

module.exports = { grade, graderName, describeGrader, GraderError };
