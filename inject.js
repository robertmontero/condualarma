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

  var total = 30, pausado = false, ultimo = null;
  var fase = { registro: false, finalizada: false };
  var login = null, accesoGuardado = false, intentoLogin = false;

  // ---------- Texto visible de Aulapp (sin el panel de CondUAlarma) ----------
  function textoDe(doc) {
    var t = "";
    if (!doc || !doc.body) return t;
    var hijos = doc.body.children;
    for (var i = 0; i < hijos.length; i++) {
      var h = hijos[i];
      if ((h.id || "").indexOf("__cua") === 0) continue;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/.test(h.tagName)) continue; // código, no texto visible
      t += " " + (h.innerText || "");
    }
    return t;
  }
  function textoPagina() {
    var t = textoDe(document);
    var frames = document.querySelectorAll("iframe, frame");
    for (var i = 0; i < frames.length; i++) {
      try { t += " " + textoDe(frames[i].contentDocument); } catch (e) {}
    }
    return norm(t);
  }
  function detectarFase() {
    var t = textoPagina();
    return {
      registro: t.indexOf("cierre de registro de entrada") !== -1,
      finalizada: t.indexOf("finalizacion de clase") !== -1
    };
  }

  // ---------- Login ----------
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  }
  function buscarLogin() {
    var passes = document.querySelectorAll('input[type="password"]');
    var pass = null;
    for (var i = 0; i < passes.length; i++) if (visible(passes[i])) { pass = passes[i]; break; }
    if (!pass) return null;
    var raiz = pass.form || document;
    var ins = raiz.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="number"]');
    var user = null;
    for (var j = 0; j < ins.length; j++) {
      if (!visible(ins[j])) continue;
      if (ins[j].compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING) user = ins[j];
    }
    if (!user) for (var k = 0; k < ins.length; k++) if (visible(ins[k])) { user = ins[k]; break; }
    return { user: user, pass: pass, form: pass.form };
  }
  function ponerValor(el, v) {
    if (!el) return;
    var proto = Object.getPrototypeOf(el);
    var d = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    d.set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  var RX_ENTRAR = /ingres|entrar|iniciar|acceder|login|sign ?in|continuar/i;
  function botonEnviar(l) {
    var raiz = l.form || document;
    var c = raiz.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, [role="button"]');
    var primero = null;
    for (var i = 0; i < c.length; i++) {
      if (!visible(c[i]) || (c[i].id || "").indexOf("__cua") === 0) continue;
      var t = (c[i].innerText || c[i].value || "").trim();
      if (RX_ENTRAR.test(t)) return c[i];
      if (!primero && (c[i].type === "submit" || (c[i].tagName === "BUTTON" && !c[i].getAttribute("type")))) primero = c[i];
    }
    return primero;
  }
  function enviarLogin(l) {
    var b = botonEnviar(l);
    if (b) { b.click(); return; }
    if (l.form) { if (l.form.requestSubmit) l.form.requestSubmit(); else l.form.submit(); return; }
    l.pass.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  }
  function entrarCon(acc, enviar) {
    var l = buscarLogin();
    if (!l || !acc || !acc.ok) return false;
    ponerValor(l.user, acc.usuario);
    ponerValor(l.pass, acc.clave);
    if (enviar) setTimeout(function () { enviarLogin(l); }, 600);
    return true;
  }
  function capturarAcceso() {
    var l = buscarLogin();
    if (!l || !l.user || !l.pass.value || !l.user.value) return;
    window.cuaCredenciales && window.cuaCredenciales(location.host, l.user.value.trim(), l.pass.value);
  }
  document.addEventListener("submit", function () { capturarAcceso(); }, true);
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest('button, input[type="submit"], input[type="button"], a, [role="button"]');
    if (!b || (b.closest("#__cua"))) return;
    if (b.type === "submit" || RX_ENTRAR.test((b.innerText || b.value || "").trim())) capturarAcceso();
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.type === "password") capturarAcceso();
  }, true);

  function usuarioEscribiendo() {
    var a = document.activeElement;
    if (!a) return false;
    var tag = (a.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || a.isContentEditable;
  }

  // ================= Cinta superior de CondUAlarma =================
  var ALTO = 58;            // alto de la cinta abierta (px)
  var cintaAbierta = false; // cerrada por defecto; solo la abre el usuario o la alarma
  var enAlarma = false;

  function ico(d, extra) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || "") + '>' + d + "</svg>";
  }
  var I = {
    reloj: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M5 4 3 6M19 4l2 2"/>',
    pausa: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    actualizar: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
    inicio: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
    anclar: '<path d="M12 16v5"/><path d="M9 3h6l-.8 5.5L17 12H7l2.8-3.5z"/>',
    sonido: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    llave: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8"/><path d="m16 7 2.5 2.5"/>',
    ajustes: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    arriba: '<path d="m6 15 6-6 6 6"/>',
    abajo: '<path d="m6 9 6 6 6-6"/>',
    campana: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    parar: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'
  };

  var CSS =
    "html.__cuaEsp{margin-top:" + ALTO + "px!important;transition:margin-top .25s ease}" +
    "#__cua,#__cuaTab,#__cuaToast{font-family:'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}" +
    "#__cua *,#__cuaTab *{box-sizing:border-box;margin:0;padding:0;line-height:1.25;letter-spacing:normal;text-transform:none;font-family:inherit}" +

    // --- cinta ---
    "#__cua{position:fixed;top:0;left:0;right:0;height:" + ALTO + "px;z-index:2147483646;display:flex;align-items:center;gap:16px;" +
    "padding:0 14px 0 16px;color:#e8edf5;font-size:13px;" +
    "background:linear-gradient(180deg,rgba(17,26,46,.86),rgba(12,19,36,.82));" +
    "border-bottom:1px solid rgba(255,255,255,.10);box-shadow:0 6px 24px rgba(4,8,20,.28),inset 0 1px 0 rgba(255,255,255,.06);" +
    "backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);" +
    "transform:translateY(-100%);transition:transform .28s cubic-bezier(.2,.8,.2,1),background .3s}" +
    "#__cua.cua-on{transform:none}" +
    "#__cua .cua-div{width:1px;align-self:stretch;margin:12px 0;background:rgba(255,255,255,.10)}" +
    "#__cua .cua-marca{display:flex;align-items:center;gap:10px;flex:none}" +
    "#__cua .cua-logo{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:#1a1300;" +
    "background:linear-gradient(145deg,#ffd666,#f5a524);box-shadow:0 4px 14px rgba(245,165,36,.35)}" +
    "#__cua .cua-nombre{font-weight:650;font-size:14.5px;letter-spacing:-.2px;color:#fff}#__cua .cua-nombre span{color:#ffc93c}" +

    "#__cua .cua-estado{display:flex;align-items:center;gap:14px;min-width:0;flex:1}" +
    "#__cua .cua-pl{flex:none;display:inline-flex;align-items:center;gap:7px;height:24px;padding:0 10px;border-radius:99px;" +
    "font-size:11.5px;font-weight:650;letter-spacing:.2px;background:rgba(148,163,184,.16);color:#cbd5e1}" +
    "#__cua .cua-pl i{width:7px;height:7px;border-radius:50%;background:currentColor}" +
    "#__cua .cua-pl.cua-esp{background:rgba(255,201,60,.14);color:#ffd666}" +
    "#__cua .cua-pl.cua-ab,#__cua .cua-pl.cua-reg{background:rgba(248,113,113,.16);color:#fca5a5}" +
    "#__cua .cua-pl.cua-ab i,#__cua .cua-pl.cua-reg i{animation:__cuaL 1s infinite}" +
    "#__cua .cua-pl.cua-ok{background:rgba(74,222,128,.14);color:#86efac}" +
    "@keyframes __cuaL{50%{opacity:.25}}" +
    "#__cua .cua-hr{flex:none;font-size:17px;font-weight:650;color:#fff;font-variant-numeric:tabular-nums}" +
    "#__cua .cua-hr em{font-style:normal;color:rgba(232,237,245,.4);font-weight:400;margin:0 6px}" +
    "#__cua .cua-det{min-width:0;display:flex;flex-direction:column}" +
    "#__cua .cua-cl{font-size:12px;color:rgba(232,237,245,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#__cua .cua-ct{font-size:12.5px;font-weight:600;color:#ffd666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +

    "#__cua .cua-con{flex:none;display:flex;flex-direction:column;gap:5px;width:190px}" +
    "#__cua .cua-con span{font-size:11.5px;color:rgba(232,237,245,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#__cua .cua-con span b{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4ade80;margin-right:6px;vertical-align:1px;box-shadow:0 0 0 3px rgba(74,222,128,.15)}" +
    "#__cua .cua-con span b.cua-mal{background:#f87171;box-shadow:0 0 0 3px rgba(248,113,113,.15)}" +
    "#__cua .cua-con span b.cua-med{background:#94a3b8;box-shadow:none}" +
    "#__cua .cua-br{height:3px;border-radius:9px;background:rgba(255,255,255,.08);overflow:hidden}" +
    "#__cua .cua-br div{height:100%;width:0;border-radius:9px;background:linear-gradient(90deg,#60a5fa,#ffc93c);transition:width 1s linear}" +

    "#__cua .cua-bt{flex:none;display:flex;align-items:center;gap:2px}" +
    "#__cua .cua-bt button,#__cua .cua-x{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;" +
    "min-width:58px;height:46px;padding:0 6px;border-radius:10px;color:#dbe3ee;font-size:10.5px;font-weight:500;transition:background .15s,color .15s}" +
    "#__cua .cua-bt button:hover,#__cua .cua-x:hover{background:rgba(255,255,255,.08);color:#fff}" +
    "#__cua .cua-bt button:active{background:rgba(255,255,255,.14)}" +
    "#__cua .cua-bt button:focus-visible,#__cua .cua-x:focus-visible,#__cuaTab:focus-visible{outline:2px solid #ffc93c;outline-offset:1px}" +
    "#__cua .cua-bt button.cua-oculto{display:none}" +
    "#__cua .cua-bt button.cua-dest{color:#ffd666}" +
    "#__cua .cua-x{min-width:40px;width:40px}" +

    // --- modo alarma ---
    "#__cua .cua-alarma{display:none;flex:1;align-items:center;gap:14px;min-width:0}" +
    "#__cua.cua-alarm{background:linear-gradient(90deg,rgba(185,28,28,.92),rgba(217,119,6,.9),rgba(185,28,28,.92));background-size:200% 100%;animation:__cuaF 2.4s linear infinite}" +
    "#__cua.cua-alarm .cua-estado,#__cua.cua-alarm .cua-con{display:none}#__cua.cua-alarm .cua-alarma{display:flex}" +
    "#__cua.cua-alarm .cua-div{background:rgba(255,255,255,.25)}" +
    "#__cua .cua-alarma .cua-cmp{animation:__cuaS .45s ease-in-out infinite alternate;display:grid}" +
    "#__cua .cua-alarma strong{font-size:18px;font-weight:700;color:#fff;letter-spacing:-.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#__cua .cua-alarma .cua-stop{all:unset;cursor:pointer;margin-left:auto;display:flex;align-items:center;gap:8px;height:36px;padding:0 16px;border-radius:10px;" +
    "background:#fff;color:#991b1b;font-weight:700;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.2)}" +
    "#__cua .cua-alarma .cua-stop:hover{background:#fef2f2}" +
    "@keyframes __cuaF{to{background-position:-200% 0}}@keyframes __cuaS{to{transform:rotate(16deg)}}" +

    // --- pestaña (cinta cerrada) ---
    "#__cuaTab{all:unset;box-sizing:border-box;position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483646;cursor:pointer;display:flex;align-items:center;gap:8px;" +
    "height:30px;padding:0 10px 0 12px;border-radius:0 0 12px 12px;color:#e8edf5;font-size:12px;font-weight:600;" +
    "background:linear-gradient(180deg,rgba(17,26,46,.9),rgba(12,19,36,.86));border:1px solid rgba(255,255,255,.12);border-top:0;" +
    "box-shadow:0 6px 18px rgba(4,8,20,.25);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);transition:transform .25s,opacity .2s}" +
    "#__cuaTab:hover{background:linear-gradient(180deg,rgba(25,37,62,.95),rgba(17,26,46,.92))}" +
    "#__cuaTab.cua-off{transform:translate(-50%,-110%);opacity:0;pointer-events:none}" +
    "#__cuaTab .cua-lg{color:#ffc93c;display:grid}#__cuaTab .cua-pt{width:7px;height:7px;border-radius:50%;background:#94a3b8}" +
    "#__cuaTab .cua-pt.cua-esp{background:#ffc93c}#__cuaTab .cua-pt.cua-ab,#__cuaTab .cua-pt.cua-reg{background:#f87171;animation:__cuaL 1s infinite}#__cuaTab .cua-pt.cua-ok{background:#4ade80}" +
    "#__cuaTab .cua-tx{max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}" +

    // --- avisos ---
    "#__cuaToast{position:fixed;left:50%;top:" + (ALTO + 12) + "px;transform:translateX(-50%);z-index:2147483647;max-width:min(560px,90vw);" +
    "padding:10px 16px;border-radius:12px;color:#fff;font-size:13px;font-weight:600;text-align:center;" +
    "background:rgba(17,26,46,.9);border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 32px rgba(4,8,20,.3);" +
    "backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);transition:opacity .35s}" +

    // --- pantallas angostas ---
    "@media (max-width:1180px){#__cua .cua-bt button span{display:none}#__cua .cua-bt button{min-width:40px}#__cua .cua-con{display:none}}" +
    "@media (max-width:900px){#__cua .cua-nombre,#__cua .cua-cl{display:none}#__cua .cua-con{display:none}}";

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
    p.setAttribute("role", "region");
    p.setAttribute("aria-label", "CondUAlarma");
    p.innerHTML =
      '<div class="cua-marca"><div class="cua-logo">' + ico(I.reloj, ' stroke-width="2.2"') + '</div>' +
      '<div class="cua-nombre">Cond<span>U</span>Alarma</div></div>' +
      '<div class="cua-div"></div>' +
      '<div class="cua-estado">' +
        '<span class="cua-pl" id="__cuaPl"><i></i><span>Buscando</span></span>' +
        '<div class="cua-hr" id="__cuaHr">--:--<em>–</em>--:--</div>' +
        '<div class="cua-det"><div class="cua-ct" id="__cuaCt"></div><div class="cua-cl" id="__cuaCl">Abre la clase para leer las horas de validación</div></div>' +
      '</div>' +
      '<div class="cua-alarma"><span class="cua-cmp">' + ico(I.campana, ' width="26" height="26" stroke-width="2"') + '</span>' +
        '<strong id="__cuaAlTx">¡Alarma!</strong>' +
        '<button class="cua-stop" id="__cuaStop">' + ico(I.parar) + 'Detener alarma</button></div>' +
      '<div class="cua-con"><span id="__cuaRec"><b class="cua-med"></b>Conectando…</span><div class="cua-br"><div id="__cuaBr"></div></div></div>' +
      '<div class="cua-div"></div>' +
      '<div class="cua-bt">' +
        '<button id="__cuaEntrar" class="cua-oculto cua-dest" title="Entrar con el acceso guardado">' + ico(I.llave) + '<span>Entrar</span></button>' +
        '<button id="__cuaPausa" title="Pausar la actualización automática (la conexión sigue activa)">' + ico(I.pausa) + '<span>Pausar</span></button>' +
        '<button id="__cuaRecargar" title="Actualizar la página ahora">' + ico(I.actualizar) + '<span>Actualizar</span></button>' +
        '<button id="__cuaInicio" title="Ir a la página anclada">' + ico(I.inicio) + '<span>Inicio</span></button>' +
        '<button id="__cuaAnclar" title="Abrir siempre CondUAlarma en esta página">' + ico(I.anclar) + '<span>Anclar</span></button>' +
        '<button id="__cuaProbar" title="Probar el sonido de la alarma">' + ico(I.sonido) + '<span>Sonido</span></button>' +
        '<button id="__cuaCfg" title="Cambiar la página de Aulapp y el acceso guardado">' + ico(I.ajustes) + '<span>Ajustes</span></button>' +
      '</div>' +
      '<button class="cua-x" id="__cuaMin" title="Ocultar la cinta" aria-label="Ocultar la cinta">' + ico(I.arriba) + '</button>';
    document.body.appendChild(p);

    var tab = document.getElementById("__cuaTab");
    if (!tab) {
      tab = document.createElement("button");
      tab.id = "__cuaTab";
      tab.title = "Mostrar CondUAlarma";
      tab.innerHTML = '<span class="cua-lg">' + ico(I.reloj, ' width="15" height="15" stroke-width="2.2"') + '</span>' +
        '<span class="cua-pt" id="__cuaTabPt"></span><span class="cua-tx" id="__cuaTabTx">CondUAlarma</span>' +
        '<span class="cua-lg" style="color:#cbd5e1">' + ico(I.abajo, ' width="15" height="15"') + '</span>';
      document.body.appendChild(tab);
    }

    // Lo que se haga en la cinta no llega a la página de Aulapp (y al revés).
    [p, tab].forEach(function (el) {
      ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "dblclick"].forEach(function (ev) {
        el.addEventListener(ev, function (e) { e.stopPropagation(); });
      });
    });

    tab.onclick = function () { abrirCinta(true, true); };
    document.getElementById("__cuaMin").onclick = function () { abrirCinta(false, true); };
    document.getElementById("__cuaStop").onclick = function () {
      window.cuaDetener && window.cuaDetener();
      window.__cuaBanner(null);
    };
    document.getElementById("__cuaPausa").onclick = function () {
      pausado = !pausado;
      window.cuaPausar && window.cuaPausar(pausado);
      pintar();
    };
    document.getElementById("__cuaRecargar").onclick = function () { location.reload(); };
    document.getElementById("__cuaInicio").onclick = function () { window.cuaInicio && window.cuaInicio(); };
    document.getElementById("__cuaProbar").onclick = function () { window.cuaProbar && window.cuaProbar(); };
    document.getElementById("__cuaCfg").onclick = function () { window.cuaConfigurar && window.cuaConfigurar(); };
    document.getElementById("__cuaAnclar").onclick = function () {
      window.cuaAnclar && window.cuaAnclar(location.href);
      __cuaToast("Página anclada: CondUAlarma abrirá aquí");
    };
    document.getElementById("__cuaEntrar").onclick = function () {
      if (!window.cuaAcceso) return;
      window.cuaAcceso(false).then(function (acc) {
        if (!acc.ok) { __cuaToast("Escribe tu usuario y contraseña y pulsa Ingresar: te preguntaré si guardarlos"); return; }
        if (!entrarCon(acc, true)) __cuaToast("No veo el formulario de ingreso en esta página");
      });
    };
    aplicarCinta();
  }

  function aplicarCinta() {
    var p = document.getElementById("__cua"), tab = document.getElementById("__cuaTab");
    if (!p || !tab) return;
    var on = cintaAbierta || enAlarma;
    p.classList.toggle("cua-on", on);
    tab.classList.toggle("cua-off", on);
    document.documentElement.classList.toggle("__cuaEsp", on);
    var t = document.getElementById("__cuaToast");
    if (t) t.style.top = (on ? ALTO + 12 : 42) + "px";
  }
  // guardar=true cuando lo decide el usuario (se recuerda al cambiar de página)
  function abrirCinta(v, guardar) {
    cintaAbierta = v;
    if (guardar && window.cuaCinta) window.cuaCinta(v);
    aplicarCinta();
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

    var est = "", etq = "Buscando clase", cuenta = "";
    if (ultimo) {
      hr.innerHTML = ultimo.min + "<em>–</em>" + (ultimo.max || "--:--");
      cl.textContent = ultimo.nombre || "Clase detectada";
      var d = new Date(), ahora = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
      var a = aMinutos(ultimo.min), z = aMinutos(ultimo.max);
      if (z === null && a !== null) z = a + 20;
      if (a !== null) {
        if (ahora < a) { est = "esp"; etq = "En espera"; cuenta = "La validación abre en " + duracion(Math.ceil(a - ahora)); }
        else if (ahora < z) { est = "ab"; etq = "Validación abierta"; cuenta = "Cierra en " + duracion(Math.ceil(z - ahora)); }
        else { est = ""; etq = "Validación cerrada"; cuenta = ""; }
      }
    } else {
      hr.innerHTML = "--:--<em>–</em>--:--";
    }
    if (fase.registro) { est = "reg"; etq = "Registro de entrada"; cuenta = "Tomando huellas · la página no se toca"; }
    else if (fase.finalizada) { est = "ok"; etq = "Clase finalizada"; cuenta = "Esperando el próximo registro de entrada"; }
    else if (login) { est = "esp"; etq = "Iniciar sesión"; cuenta = accesoGuardado ? "Acceso guardado · pulsa Entrar" : "Al ingresar te preguntaré si guardar el acceso"; }
    pl.className = "cua-pl cua-" + est;
    pl.lastChild.textContent = etq;
    ct.textContent = cuenta;

    var faltan = Math.max(0, total - Math.floor((Date.now() - ultimoChequeo) / 1000));
    var hora = ultimaOk ? " · " + ultimaOk.toTimeString().slice(0, 5) : "";
    var claseDot = /Sin internet|Reintentando|vencida/.test(estadoConexion) ? "cua-mal" : (ultimaOk ? "" : "cua-med");
    if (login) r.innerHTML = '<b class="cua-med"></b>Inicia sesión para conectar';
    else r.innerHTML = '<b class="' + claseDot + '"></b>' + estadoConexion + hora + " · revisa en " + faltan + " s";
    br.style.width = login ? "0%" : (100 * (total - faltan) / total) + "%";

    var be = document.getElementById("__cuaEntrar");
    if (be) be.classList.toggle("cua-oculto", !login);
    b.innerHTML = pausado ? ico(I.play) + "<span>Reanudar</span>" : ico(I.pausa) + "<span>Pausar</span>";
    b.classList.toggle("cua-dest", pausado);

    // Pestaña de la cinta cerrada: estado en una línea
    var tp = document.getElementById("__cuaTabPt"), tt = document.getElementById("__cuaTabTx");
    if (tp) {
      tp.className = "cua-pt cua-" + est;
      tt.textContent = etq + (ultimo && !login ? " · " + ultimo.min + "–" + (ultimo.max || "--:--") : "");
    }
  }

  function hoyEs(fecha) {
    var m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(fecha || "");
    if (!m) return true;
    var d = new Date();
    return +m[1] === d.getDate() && +m[2] === d.getMonth() + 1 && +m[3] === d.getFullYear();
  }
  function validacionAbierta() {
    if (!ultimo || !hoyEs(ultimo.fecha)) return false;
    var a = aMinutos(ultimo.min), z = aMinutos(ultimo.max);
    if (a === null) return false;
    if (z === null) z = a + 20;
    var d = new Date(), ahora = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    return ahora >= a && ahora < z;
  }
  // Devuelve por qué NO se debe recargar la página visible (o "" si se puede).
  function motivoSinRecarga() {
    if (fase.registro) return "registro de entrada";
    if (validacionAbierta()) return "validación abierta";
    if (pausado) return "en pausa";
    if (login) return "inicio de sesión";
    if (usuarioEscribiendo()) return "estás escribiendo";
    return "";
  }

  // ---------- Conexión en segundo plano (sin recargar la página visible) ----------
  // Cada 30 s se pide la misma página a Aulapp por detrás. Eso mantiene viva la sesión
  // y permite ver si cambió algo (registro de entrada, horas de validación, sesión vencida).
  // La página visible solo se recarga cuando de verdad hay algo nuevo que mostrar.
  var ultimoChequeo = Date.now(), chequeando = false, firmaPrevia = null, fallos = 0;
  var ultimaOk = null, sinInfoDesde = null, estadoConexion = "Conectando…";
  var RESPALDO_MS = 5 * 60 * 1000; // si Aulapp no deja leer la página por detrás

  function textoDoc(doc) {
    var q = doc.querySelectorAll("script,style,noscript,template");
    for (var i = 0; i < q.length; i++) q[i].remove();
    return norm(doc.body ? doc.body.textContent : "");
  }
  function firmaDe(t) {
    t = t.replace(/\d+/g, "#"); // ignora relojes y contadores
    var h = 0;
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return h + ":" + t.length;
  }
  function recargarPor(razon) {
    var m = motivoSinRecarga();
    if (m && razon !== "sesión vencida") return false; // nunca interrumpe la toma de huellas
    if (fase.registro) return false;
    try { sessionStorage.setItem("__cuaRazon", razon); } catch (e) {}
    location.reload();
    return true;
  }
  function chequeo(forzar) {
    if (chequeando || login) return;
    if (location.protocol === "file:") { estadoConexion = "Archivo local"; ultimoChequeo = Date.now(); return; }
    if (!forzar && Date.now() - ultimoChequeo < total * 1000) return;
    chequeando = true;
    ultimoChequeo = Date.now();
    fetch(location.href, { credentials: "include", cache: "no-store", redirect: "follow" })
      .then(function (r) { return r.text().then(function (h) { return { r: r, h: h }; }); })
      .then(function (x) {
        if (x.r.status === 401 || x.r.status === 403) { recargarPor("sesión vencida"); return; }
        var doc = new DOMParser().parseFromString(x.h, "text/html");
        if (doc.querySelector('input[type="password"]')) { estadoConexion = "Sesión vencida"; recargarPor("sesión vencida"); return; }
        var c = escanear(doc);
        var t = textoDoc(doc);
        var f = { registro: t.indexOf("cierre de registro de entrada") !== -1,
                  finalizada: t.indexOf("finalizacion de clase") !== -1 };
        fallos = 0;
        ultimaOk = new Date();

        if (f.registro && !fase.registro) {
          window.cuaFase && window.cuaFase(f); // suena aunque la página aún no se haya recargado
          recargarPor("registro de entrada");
          return;
        }
        if (c && (!ultimo || c.min !== ultimo.min || c.max !== ultimo.max)) {
          window.cuaReportar && window.cuaReportar(c);
          if (recargarPor("nuevas horas de validación")) return;
        }
        var firma = firmaDe(t);
        if (t.length < 150) {
          // Aulapp arma esta página con JavaScript: por detrás no se ve el contenido.
          if (!sinInfoDesde) sinInfoDesde = Date.now();
          estadoConexion = "Conexión activa";
          if (Date.now() - sinInfoDesde > RESPALDO_MS && recargarPor("revisión de respaldo")) return;
        } else {
          sinInfoDesde = null;
          if (firmaPrevia && firma !== firmaPrevia && recargarPor("la página cambió")) return;
          firmaPrevia = firma;
          estadoConexion = "Conexión activa";
        }
      })
      .catch(function () {
        fallos++;
        estadoConexion = navigator.onLine ? "Reintentando…" : "Sin internet";
        if (fallos >= 3 && navigator.onLine) recargarPor("se perdió la conexión");
      })
      .then(function () { chequeando = false; pintar(); });
  }
  // CondUAlarma (Windows) llama esto cada 10 s, aunque la ventana esté minimizada.
  window.__cuaLatido = function () { chequeo(false); pintar(); };

  window.__cuaToast = function (texto, ms) {
    if (!document.getElementById("__cuaCss")) crearPanel();
    var t = document.getElementById("__cuaToast");
    if (!t) { t = document.createElement("div"); t.id = "__cuaToast"; document.body.appendChild(t); }
    t.textContent = texto;
    t.style.top = ((cintaAbierta || enAlarma) ? ALTO + 12 : 42) + "px";
    t.style.opacity = "1";
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 450); }, ms || 4500);
  };
  var __cuaToast = function (t, ms) { window.__cuaToast(t, ms); };

  // Alarma: la cinta se abre sola y se pone en rojo hasta que se detiene.
  window.__cuaBanner = function (texto) {
    if (!document.getElementById("__cua")) crearPanel();
    var p = document.getElementById("__cua");
    if (!texto) { enAlarma = false; if (p) p.classList.remove("cua-alarm"); aplicarCinta(); return; }
    enAlarma = true;
    cintaAbierta = true; // CondUAlarma (Windows) ya recordó que debe quedar abierta
    document.getElementById("__cuaAlTx").textContent = texto;
    p.classList.add("cua-alarm");
    aplicarCinta();
  };

  function iniciar() {
    if (document.querySelector('meta[name="cua-setup"]')) return;
    crearPanel();
    if (window.cuaEstado) {
      window.cuaEstado().then(function (e) {
        pausado = !!e.pausado;
        total = e.segundos || 30;
        cintaAbierta = !!e.cinta;
        if (e.alarmando) window.__cuaBanner(e.alarmaTexto || "¡Alarma!");
        aplicarCinta();
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
      fase = detectarFase();
      window.cuaFase && window.cuaFase(fase);
      login = buscarLogin();
      if (login && !intentoLogin && window.cuaAcceso) {
        intentoLogin = true;
        window.cuaAcceso(true).then(function (acc) {
          accesoGuardado = !!acc.ok;
          if (!acc.ok) { pintar(); return; }
          if (acc.auto) {
            __cuaToast("🔑 Entrando con tu acceso guardado…");
            entrarCon(acc, true);
          } else {
            entrarCon(acc, false);
            if (acc.bloqueado) __cuaToast("No se pudo entrar solo. Revisa la contraseña y pulsa Ingresar.", 8000);
            else __cuaToast("Usuario y contraseña listos: pulsa 🔑 Entrar o Ingresar.");
          }
          pintar();
        }).catch(function () {});
      }
      pintar();
    };
    var tick = 0;
    revisar();
    setTimeout(revisar, 1500);

    try {
      var razon = sessionStorage.getItem("__cuaRazon");
      if (razon) { sessionStorage.removeItem("__cuaRazon"); setTimeout(function () { __cuaToast("↻ Página actualizada: " + razon); }, 600); }
    } catch (e) {}
    setTimeout(function () { chequeo(true); }, 3000); // toma la "foto" inicial de la página
    window.addEventListener("online", function () { chequeo(true); });

    setInterval(function () {
      if (!document.getElementById("__cua")) crearPanel();
      chequeo(false);
      if (++tick % 3 === 0) revisar();
      pintar();
    }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
