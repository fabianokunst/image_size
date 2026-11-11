// Verificações do ToolBox Web: sincronia com o GitHub, tipos, build e site publicado.
//
//   npm run check                            verificação completa: git, dependências, typecheck,
//                                            build, GitHub Actions e site no ar. Termina com
//                                            "Pode enviar." (código 0) ou "Não envie" (código 1)
//   node scripts/check.mjs --session-start   hook do Claude Code ao abrir uma sessão: busca o GitHub,
//                                            traz commits novos (se não há trabalho local) e
//                                            resume o estado
//   node scripts/check.mjs --stop            hook do Claude Code ao fim de cada resposta: não deixa
//                                            arquivo sem commit nem commit sem push
//
// Marcadores: [ok] certo · [..] informação · [aviso] problema no GitHub/site (não impede o envio)
//             [ERRO] impede o envio (tipos, build, cópia local atrás do GitHub...)
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'fabianokunst/image_size';
const REMOTE = `https://fabianokunst@github.com/${REPO}.git`;
const SITE = 'https://fabianokunst.github.io/image_size/';
const WORKFLOW = 'Publicar no GitHub Pages';
const BUNDLE = /assets\/index-[\w-]+\.js/;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv.includes('--session-start') ? 'session' : process.argv.includes('--stop') ? 'stop' : 'full';

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}
function trySh(cmd) {
  try { return { ok: true, out: sh(cmd) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}
const indent = (text, n = 15) => text.split('\n').slice(-n).map(l => '      ' + l).join('\n');

function gitState() {
  const status = sh('git status --porcelain');
  const counts = trySh('git rev-list --left-right --count origin/main...HEAD');
  const [behind, ahead] = counts.ok ? counts.out.trim().split(/\s+/).map(Number) : [0, 0];
  return { status, behind, ahead };
}

// ---- --stop: só olha o estado local, rápido -----------------------------------
if (mode === 'stop') {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* sem entrada */ }
  if (input.stop_hook_active) process.exit(0); // já cobrou uma vez nesta resposta: não entra em loop
  const { status, ahead } = gitState();
  if (status || ahead) {
    const what = [status && `Arquivos sem commit:\n${status}`, ahead && `${ahead} commit(s) ainda sem push.`]
      .filter(Boolean).join('\n');
    console.log(JSON.stringify({
      decision: 'block',
      reason: `${what}\n\nEste projeto deve ficar sempre igual ao GitHub (${REPO}). Rode "npm run check"; `
        + 'se terminar com "Pode enviar.", faça commit de todos os arquivos e "git push" (autorizado pelo dono, '
        + 'não pergunte). Se terminar com "Não envie", corrija os itens [ERRO] ou explique ao usuário o que impede o envio.',
    }));
  }
  process.exit(0);
}

// ---- verificação (sessão e completa) --------------------------------------------
const lines = [];
const errors = [];
const warnings = [];
const first = m => m.split('\n')[0];
const ok = m => lines.push('[ok] ' + m);
const info = m => lines.push('[..] ' + m);
const warn = m => { warnings.push(first(m)); lines.push('[aviso] ' + m); };
const error = m => { errors.push(first(m)); lines.push('[ERRO] ' + m); };

function checkGit() {
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') error(`branch atual é "${branch}"; o projeto trabalha direto na main`);
  const url = sh('git remote get-url origin');
  if (url !== REMOTE) error(`remote origin é ${url}; o esperado é ${REMOTE} (conta fabianokunst)`);

  const fetched = trySh('git fetch --quiet origin');
  if (!fetched.ok) warn('não consegui buscar o GitHub (sem internet?): ' + first(fetched.out));
  let { status, behind, ahead } = gitState();
  if (behind && !ahead && !status) {
    const merged = trySh('git merge --ff-only --quiet origin/main');
    if (merged.ok) { ok(`trouxe ${behind} commit(s) novo(s) do GitHub`); behind = 0; }
    else error('não consegui atualizar com o GitHub:\n' + indent(merged.out));
  }
  if (behind) error(`o GitHub tem ${behind} commit(s) que não estão aqui e há trabalho local: rode "git pull --rebase --autostash"`);
  if (ahead) info(`${ahead} commit(s) local(is) ainda sem push`);
  if (status) info('alterações ainda sem commit:\n' + status.split('\n').map(l => '      ' + l).join('\n'));
  const synced = !behind && !ahead && !status;
  if (synced) ok(`igual ao GitHub (${sh('git rev-parse --short HEAD')})`);
  return synced;
}

function checkBuild() {
  const lock = join(ROOT, 'package-lock.json');
  const installed = join(ROOT, 'node_modules', '.package-lock.json');
  if (existsSync(installed) && existsSync(join(ROOT, 'src', 'vendor'))
      && statSync(installed).mtimeMs >= statSync(lock).mtimeMs) {
    ok('dependências instaladas');
  } else {
    const r = trySh('npm ci --no-audit --no-fund');
    if (r.ok) ok('dependências reinstaladas (npm ci)'); else { error('npm ci falhou:\n' + indent(r.out)); return null; }
  }
  const tc = trySh('npm run typecheck');
  if (tc.ok) ok('typecheck'); else error('typecheck falhou:\n' + indent(tc.out));
  const b = trySh('npm run build:all');
  if (!b.ok) { error('build falhou:\n' + indent(b.out)); return null; }
  ok('build (dist/ e dist-single/toolbox-web.html)');
  return readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8').match(BUNDLE)?.[0] ?? null;
}

async function getJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'toolbox-web-check', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function checkGitHub() {
  const head = trySh('git rev-parse origin/main');
  if (!head.ok) return null;
  const short = head.out.slice(0, 7);
  let runs;
  try { runs = (await getJson(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${head.out}`)).workflow_runs || []; }
  catch (e) { info(`não consegui consultar o GitHub Actions (${e.message})`); return null; }
  const wf = runs.find(r => r.name === WORKFLOW);
  if (!wf) info(`nenhuma execução do workflow para ${short}`);
  else if (wf.status !== 'completed') info(`deploy de ${short} ainda rodando: ${wf.html_url}`);
  else if (wf.conclusion === 'success') ok(`deploy de ${short} concluído no GitHub Actions`);
  else warn(`deploy de ${short} terminou como "${wf.conclusion}": ${wf.html_url}`);
  if (runs.some(r => r.name === 'pages build and deployment')) {
    warn('o Pages também publica direto da branch, em paralelo ao workflow, e pode pôr no ar o index.html de '
      + 'desenvolvimento. O dono precisa mudar em Settings → Pages → Build and deployment → Source: GitHub Actions');
  }
  return wf;
}

async function checkSite(localBundle, wf) {
  const deploying = wf && wf.status !== 'completed';
  let html;
  try {
    const r = await fetch(`${SITE}?nocache=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return warn(`site fora do ar (HTTP ${r.status}): ${SITE}`);
    html = await r.text();
  } catch (e) { return info(`não consegui abrir o site (${e.message})`); }
  const live = html.match(BUNDLE)?.[0];
  if (!live) return warn(`o site no ar não é o build do ToolBox Web (sem assets/index-*.js): ${SITE}`);
  if (localBundle && live !== localBundle) {
    const msg = `o site no ar usa ${live}, mas o build local gera ${localBundle}`;
    if (deploying) info(msg + ' (deploy em andamento)'); else warn(msg);
  } else {
    ok(`site no ar${localBundle ? ', igual ao build local' : ''} (${live})`);
  }
  try {
    const s = await fetch(`${SITE}toolbox-web.html`, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    if (s.ok) ok('toolbox-web.html disponível no site');
    else if (deploying) info('toolbox-web.html ainda não está no site (deploy em andamento)');
    else warn(`toolbox-web.html não está no site (HTTP ${s.status})`);
  } catch (e) { info(`não consegui conferir o toolbox-web.html (${e.message})`); }
}

try {
  const synced = checkGit();
  const localBundle = mode === 'full' ? checkBuild() : null;
  const wf = await checkGitHub();
  await checkSite(synced ? localBundle : null, wf);
} catch (e) {
  error('erro inesperado na verificação: ' + e.message);
}

if (mode === 'session') {
  const issues = [...errors, ...warnings];
  console.log(JSON.stringify({
    systemMessage: issues.length
      ? `ToolBox Web: ${issues.length} ponto(s) para resolver — ${issues.join(' | ')}`
      : 'ToolBox Web: projeto conferido com o GitHub, tudo certo',
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'Verificação automática do projeto (scripts/check.mjs --session-start):\n' + lines.join('\n')
        + (issues.length ? '\n\nResolva os itens [ERRO] e informe ao usuário os itens [aviso] antes de seguir com outra coisa.' : ''),
    },
  }));
} else {
  console.log(lines.join('\n'));
  if (errors.length) console.log(`\nNão envie: ${errors.length} erro(s) [ERRO] acima.`);
  else console.log(`\nPode enviar.${warnings.length ? ` (${warnings.length} aviso(s) do GitHub/site acima)` : ''}`);
  process.exitCode = errors.length ? 1 : 0;
}
