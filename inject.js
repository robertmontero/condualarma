// Se inyecta en cada página que abre CondUAlarma.
(function () {
  if (window.__cuaCargado) return;
  window.__cuaCargado = true;

  var esTop = window.top === window;

  function norm(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  }

  // Busca el valor que acompaña a una etiqueta, p. ej. "Hora mínima validación:" → "16:55"
  function valorDe(doc, etiqueta) {
    var buscado = norm(etiqueta);
    var labels = doc.querySelectorAll("label, th, dt, strong, b, span, td, div");
    for (var i = 0; i < labels.length; i++) {
      var el = labels[i];
      if (el.children.length > 1) continue;
      var t = norm(el.textContent).replace(/:$/, "");
      if (t !== buscado) continue;
      // Estructura de Aulapp: <div class="row"><div><label>X:</label></div> <div class="text-right">valor</div></div>
      var fila = el.closest(".row");
      if (fila) {
        var der = fila.querySelector(".text-right");
        if (der && norm(der.textContent) !== t) return der.textContent.trim();
      }
      // Respaldo: el siguiente elemento hermano del contenedor de la etiqueta
      var nodo = el.parentElement && el.parentElement.nextElementSibling ? el.parentElement : el;
      var sig = nodo.nextElementSibling;
      if (sig && sig.textContent.trim()) return sig.textContent.trim();
    }
    return "";
  }

  function escanear(doc) {
    var min = valorDe(doc, "Hora mínima validación");
    if (!min) return null;
    return {
      fecha: valorDe(doc, "Fecha"),
      nombre: valorDe(doc, "Nombre de la clase"),
      min: min,
      max: valorDe(doc, "Hora máxima validación"),
    };
  }

  function escanearTodo() {
    var c = escanear(document);
    if (c) return c;
    // Iframes del mismo sitio
    var frames = document.querySelectorAll("iframe, frame");
    for (var i = 0; i < frames.length; i++) {
      try {
        var d = frames[i].contentDocument;
        if (d) { c = escanear(d); if (c) return c; }
      } catch (e) {}
    }
    return null;
  }

  if (!esTop) return; // el panel y la recarga solo en la ventana principal
  if (location.protocol === "data:" || location.href === "about:blank") return; // pantalla de configuración

  var restante = 30, total = 30, pausado = false, ultimo = null;

  function usuarioEscribiendo() {
    var a = document.activeElement;
    if (!a) return false;
    var tag = (a.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || a.isContentEditable;
  }

  var CSS =
    "#__cua,#__cua *{box-sizing:border-box;font-family:'Segoe UI Variable','Segoe UI',system-ui,sans-serif}" +
    "#__cua{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;color:#f4f7fb;font-size:13px;line-height:1.4;" +
    "padding:14px 14px 12px;border-radius:20px;background:linear-gradient(145deg,rgba(22,34,62,.72),rgba(10,16,32,.62));" +
    "border:1px solid rgba(255,255,255,.18);box-shadow:0 20px 50px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.2);" +
    "backdrop-filter:blur(22px) saturate(170%);-webkit-backdrop-filter:blur(22px) saturate(170%);transition:width .25s}" +
    "#__cua.min{width:auto}#__cua.min .cb{display:none}" +
    "#__cua .hd{display:flex;align-items:center;gap:9px}" +
    "#__cua .lg{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;font-size:16px;" +
    "background:linear-gradient(145deg,rgba(255,201,60,.4),rgba(255,201,60,.08));border:1px solid rgba(255,201,60,.5)}" +
    "#__cua .nm{font-weight:700;font-size:14px;flex:1;letter-spacing:-.2px}#__cua .nm span{color:#ffc93c}" +
    "#__cua .x{all:unset;cursor:pointer;width:24px;height:24px;border-radius:8px;display:grid;place-items:center;color:#fff;opacity:.7}" +
    "#__cua .x:hover{background:rgba(255,255,255,.12);opacity:1}" +
    "#__cua .es{margin-top:12px;padding:12px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}" +
    "#__cua .pl{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;" +
    "padding:3px 9px;border-radius:99px;background:rgba(148,163,184,.2);color:#cbd5e1}" +
    "#__cua .pl i{width:7px;height:7px;border-radius:50%;background:currentColor}" +
    "#__cua .pl.esp{background:rgba(255,201,60,.18);color:#ffd666}" +
    "#__cua .pl.ab{background:rgba(34,197,94,.2);color:#4ade80}#__cua .pl.ab i{animation:__cuaL 1s infinite}" +
    "#__cua .pl.ce{background:rgba(148,163,184,.15);color:#94a3b8}" +
    "@keyframes __cuaL{50%{opacity:.2}}" +
    "#__cua .hr{font-size:24px;font-weight:700;letter-spacing:-.5px;margin:8px 0 2px}#__cua .hr em{font-style:normal;opacity:.45;font-weight:400;margin:0 6px}" +
    "#__cua .cl{font-size:12px;color:rgba(235,242,255,.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#__cua .ct{font-size:12.5px;margin-top:6px;color:#ffd666;font-weight:600}" +
    "#__cua .rc{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:12px;color:rgba(235,242,255,.75)}" +
    "#__cua .br{flex:1;height:5px;border-radius:9px;background:rgba(255,255,255,.1);overflow:hidden}" +
    "#__cua .br div{height:100%;border-radius:9px;background:linear-gradient(90deg,#60a5fa,#ffc93c);transition:width 1s linear}" +
    "#__cua .bt{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px}" +
    "#__cua .bt button{all:unset;cursor:pointer;text-align:center;padding:8px 2px 6px;border-radius:12px;font-size:10.5px;color:#e2e8f0;" +
    "background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);transition:.15s}" +
    "#__cua .bt button b{display:block;font-size:16px;margin-bottom:2px;font-weight:400}" +
    "#__cua .bt button:hover{background:rgba(255,255,255,.14);transform:translateY(-1px)}" +
    "#__cua .ft{margin-top:8px;text-align:right}#__cua .ft a{color:rgba(235,242,255,.5);font-size:11px;cursor:pointer;text-decoration:none}" +
    "#__cua .ft a:hover{color:#fff}" +
    "#__cuaBan{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:14px;" +
    "padding:16px 28px;border-radius:22px;color:#fff;font:700 26px 'Segoe UI',system-ui,sans-serif;letter-spacing:-.3px;" +
    "background:linear-gradient(135deg,rgba(239,68,68,.85),rgba(245,158,11,.8));border:1px solid rgba(255,255,255,.35);" +
    "box-shadow:0 20px 60px rgba(239,68,68,.45),inset 0 1px 0 rgba(255,255,255,.35);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);" +
    "animation:__cuaP 1.2s ease-in-out infinite}" +
    "#__cuaBan b{font-size:32px;animation:__cuaS .5s ease-in-out infinite alternate}" +
    "@keyframes __cuaP{50%{box-shadow:0 20px 80px rgba(245,158,11,.7),inset 0 1px 0 rgba(255,255,255,.35);transform:translateX(-50%) scale(1.03)}}" +
    "@keyframes __cuaS{to{transform:rotate(14deg)}}";

  function crearPanel() {
    if (document.getElementById("__cua")) return;
    if (!document.getElementById("__cuaCss")) {
      var css = document.createElement("style");
      css.id = "__cuaCss";
      css.textContent = CSS;
      document.documentElement.appendChild(css);
    }
    var p = document.createElement("div");
    p.id = "__cua";
    p.innerHTML =
      '<div class="hd"><div class="lg">⏰</div><div class="nm">Cond<span>U</span>Alarma</div>' +
      '<button class="x" id="__cuaMin" title="Minimizar">▾</button></div>' +
      '<div class="cb">' +
      '<div class="es"><span class="pl" id="__cuaPl"><i></i><span>Buscando</span></span>' +
      '<div class="hr" id="__cuaHr">--:--<em>→</em>--:--</div>' +
      '<div class="cl" id="__cuaCl">Abre la clase para leer las horas de validación</div>' +
      '<div class="ct" id="__cuaCt"></div></div>' +
      '<div class="rc"><span id="__cuaRec">Recarga en 30 s</span><div class="br"><div id="__cuaBr"></div></div></div>' +
      '<div class="bt">' +
      '<button id="__cuaPausa"><b>⏸</b><span>Pausar</span></button>' +
      '<button id="__cuaRecargar"><b>↻</b>Recargar</button>' +
      '<button id="__cuaInicio"><b>⌂</b>Inicio</button>' +
      '<button id="__cuaProbar"><b>🔊</b>Probar</button></div>' +
      '<div class="ft"><a id="__cuaCfg">Cambiar página de Aulapp</a></div></div>';
    document.body.appendChild(p);

    document.getElementById("__cuaPausa").onclick = function () {
      pausado = !pausado;
      window.cuaPausar && window.cuaPausar(pausado);
      pintar();
    };
    document.getElementById("__cuaRecargar").onclick = function () { location.reload(); };
    document.getElementById("__cuaInicio").onclick = function () { window.cuaInicio && window.cuaInicio(); };
    document.getElementById("__cuaProbar").onclick = function () { window.cuaProbar && window.cuaProbar(); };
    document.getElementById("__cuaCfg").onclick = function () { window.cuaConfigurar && window.cuaConfigurar(); };
    document.getElementById("__cuaMin").onclick = function () {
      p.classList.toggle("min");
      this.textContent = p.classList.contains("min") ? "▴" : "▾";
    };
  }

  function aMinutos(h) {
    var m = /(\d{1,2}):(\d{2})/.exec(h || "");
    if (!m) return null;
    var hh = +m[1], t = (h || "").toLowerCase();
    if (/p/.test(t) && hh < 12) hh += 12;
    if (/a/.test(t) && hh === 12) hh = 0;
    return hh * 60 + +m[2];
  }

  function duracion(min) {
    if (min < 60) return min + " min";
    return Math.floor(min / 60) + " h " + (min % 60) + " min";
  }

  function pintar() {
    var pl = document.getElementById("__cuaPl");
    if (!pl) return;
    var hr = document.getElementById("__cuaHr"), cl = document.getElementById("__cuaCl"),
        ct = document.getElementById("__cuaCt"), r = document.getElementById("__cuaRec"),
        br = document.getElementById("__cuaBr"), b = document.getElementById("__cuaPausa");

    var est = "", etq = "Buscando", cuenta = "";
    if (ultimo) {
      hr.innerHTML = ultimo.min + "<em>→</em>" + (ultimo.max || "--:--");
      cl.textContent = ultimo.nombre || "Clase detectada";
      var d = new Date(), ahora = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
      var a = aMinutos(ultimo.min), z = aMinutos(ultimo.max);
      if (z === null && a !== null) z = a + 20;
      if (a !== null) {
        if (ahora < a) { est = "esp"; etq = "En espera"; cuenta = "Abre en " + duracion(Math.ceil(a - ahora)); }
        else if (ahora < z) { est = "ab"; etq = "Validación abierta"; cuenta = "Cierra en " + duracion(Math.ceil(z - ahora)); }
        else { est = "ce"; etq = "Cerrada"; cuenta = ""; }
      }
    }
    pl.className = "pl " + est;
    pl.lastChild.textContent = etq;
    ct.textContent = cuenta;

    if (pausado) r.textContent = "Recarga en pausa";
    else if (usuarioEscribiendo()) r.textContent = "En espera (escribiendo)";
    else r.textContent = "Recarga en " + restante + " s";
    br.style.width = pausado ? "0%" : (100 * (total - restante) / total) + "%";
    b.innerHTML = pausado ? "<b>▶</b>Reanudar" : "<b>⏸</b>Pausar";
  }

  window.__cuaBanner = function (texto) {
    var b = document.getElementById("__cuaBan");
    if (!texto) { if (b) b.remove(); return; }
    if (!document.getElementById("__cuaCss")) crearPanel();
    if (!b) { b = document.createElement("div"); b.id = "__cuaBan"; document.body.appendChild(b); }
    b.innerHTML = "<b>⏰</b><span></span>";
    b.lastChild.textContent = texto;
  };

  function iniciar() {
    if (document.querySelector('meta[name="cua-setup"]')) return;
    crearPanel();
    if (window.cuaEstado) {
      window.cuaEstado().then(function (e) {
        pausado = !!e.pausado;
        restante = total = e.segundos || 30;
        if (e.clase) ultimo = e.clase;
        pintar();
      }).catch(function () {});
    }
    var revisar = function () {
      var c = escanearTodo();
      if (c) {
        ultimo = c;
        window.cuaReportar && window.cuaReportar(c);
      }
      pintar();
    };
    revisar();
    setTimeout(revisar, 1500);

    setInterval(function () {
      if (!document.getElementById("__cua")) crearPanel();
      if (!pausado && !usuarioEscribiendo()) {
        restante--;
        if (restante <= 0) { location.reload(); return; }
      }
      if (restante % 5 === 0) revisar();
      pintar();
    }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
