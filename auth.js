/* Gate de acceso simple para apps.jorgeweddings.com
   La contraseña se compara contra el SHA-256 hardcodeado.
   No es seguridad criptográfica fuerte — solo una barrera para visitantes casuales. */
(() => {
  const HASH = "7db720dcf7e435a357e418722016d841fdfc48f0606d4c5d0a849ca68e2f8728";
  const KEY = "jw-apps-auth";
  const TTL_DAYS = 30;

  // Si ya hay sesión válida, salir sin hacer nada
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && v.h === HASH && Date.now() - v.t < TTL_DAYS * 86400_000) return;
  } catch {}

  // Ocultar contenido inmediatamente (antes de pintar)
  const style = document.createElement("style");
  style.textContent = `
    html, body { background: #0f0f0f !important; }
    body > *:not(.jw-gate) { visibility: hidden !important; }
    .jw-gate {
      position: fixed; inset: 0; z-index: 999999;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f0f0f; color: #fff;
    }
    .jw-gate-card {
      background: #1a1a1a; border: 1px solid #333; border-radius: 14px;
      padding: 32px 28px; width: 320px; max-width: 90vw;
      box-shadow: 0 30px 80px rgba(0,0,0,.5);
    }
    .jw-gate-card h1 { font-size: 1.4rem; font-weight: 300; letter-spacing: .08em; margin: 0 0 4px; }
    .jw-gate-card h1 span { color: #c9a96e; }
    .jw-gate-card p { color: #888; margin: 0 0 22px; font-size: 0.9rem; }
    .jw-gate-card input {
      width: 100%; padding: 11px 13px; border-radius: 8px;
      background: #0a0a0a; border: 1px solid #333; color: #fff;
      font-size: 14px; outline: none; box-sizing: border-box;
    }
    .jw-gate-card input:focus { border-color: #c9a96e; }
    .jw-gate-card button {
      width: 100%; margin-top: 12px; padding: 11px;
      background: #c9a96e; color: #000; border: 0; border-radius: 8px;
      font-weight: 600; font-size: 14px; cursor: pointer;
    }
    .jw-gate-card button:hover { background: #d6b67e; }
    .jw-gate-err { color: #e36e6e; font-size: 12px; margin-top: 8px; min-height: 16px; }
  `;
  document.documentElement.appendChild(style);

  function buildGate() {
    const wrap = document.createElement("div");
    wrap.className = "jw-gate";
    wrap.innerHTML = `
      <div class="jw-gate-card">
        <h1>Jorge <span>Weddings</span></h1>
        <p>Acceso privado</p>
        <input id="jw-gate-pw" type="password" autofocus autocomplete="current-password" placeholder="Contraseña">
        <div class="jw-gate-err" id="jw-gate-err"></div>
        <button id="jw-gate-go">Entrar</button>
      </div>
    `;
    (document.body || document.documentElement).appendChild(wrap);
    const input = wrap.querySelector("#jw-gate-pw");
    const err = wrap.querySelector("#jw-gate-err");
    const btn = wrap.querySelector("#jw-gate-go");
    async function check() {
      err.textContent = "";
      const buf = new TextEncoder().encode(input.value);
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,"0")).join("");
      if (hash === HASH) {
        localStorage.setItem(KEY, JSON.stringify({ h: HASH, t: Date.now() }));
        wrap.remove(); style.remove();
      } else {
        err.textContent = "Contraseña incorrecta";
        input.value = ""; input.focus();
      }
    }
    btn.addEventListener("click", check);
    input.addEventListener("keydown", e => { if (e.key === "Enter") check(); });
  }
  if (document.body) buildGate();
  else document.addEventListener("DOMContentLoaded", buildGate);
})();
