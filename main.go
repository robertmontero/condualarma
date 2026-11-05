// CondUAlarma — navegador para Aulapp que mantiene la sesión viva (recarga
// cada 30 s), detecta la "Hora mínima / máxima validación" de la clase y
// hace sonar una alarma cuando se abre la ventana de validación de huellas.
package main

import (
	_ "embed"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

//go:embed inject.js
var injectJS string

//go:embed setup.html
var setupHTML string

const recargaSegundos = 30

// ---------------- Configuración ----------------

type Config struct {
	URL string `json:"url"`
}

func carpetaApp() string {
	base := os.Getenv("APPDATA")
	if base == "" {
		base, _ = os.UserConfigDir()
	}
	dir := filepath.Join(base, "CondUAlarma")
	os.MkdirAll(dir, 0o755)
	return dir
}

func cargarConfig() Config {
	var c Config
	b, err := os.ReadFile(filepath.Join(carpetaApp(), "config.json"))
	if err == nil {
		json.Unmarshal(b, &c)
	}
	return c
}

func guardarConfig(c Config) {
	b, _ := json.MarshalIndent(c, "", "  ")
	os.WriteFile(filepath.Join(carpetaApp(), "config.json"), b, 0o644)
}

// ---------------- Win32 ----------------

var (
	user32         = syscall.NewLazyDLL("user32.dll")
	winmm          = syscall.NewLazyDLL("winmm.dll")
	pMessageBox    = user32.NewProc("MessageBoxW")
	pSetForeground = user32.NewProc("SetForegroundWindow")
	pShowWindow    = user32.NewProc("ShowWindow")
	pFlashWindowEx = user32.NewProc("FlashWindowEx")
	pSetWindowPos  = user32.NewProc("SetWindowPos")
	pPlaySound     = winmm.NewProc("PlaySoundW")
	pBeep          = syscall.NewLazyDLL("kernel32.dll").NewProc("Beep")
)

const (
	sndAsync    = 0x0001
	sndMemory   = 0x0004
	sndLoop     = 0x0008
	mbOK        = 0x0000
	mbIconWarn  = 0x0030
	mbIconInfo  = 0x0040
	mbTopmost   = 0x40000
	mbSetFg     = 0x10000
	swRestore   = 9
	flashAll    = 0x3
	flashTimer  = 0x4
	hwndTopmost = ^uintptr(0)     // -1
	hwndNoTop   = ^uintptr(1)     // -2
	swpFlags    = 0x0001 | 0x0002 // NOSIZE | NOMOVE
)

type flashInfo struct {
	cbSize    uint32
	hwnd      uintptr
	dwFlags   uint32
	uCount    uint32
	dwTimeout uint32
}

func u16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func mensaje(hwnd uintptr, titulo, texto string, flags uintptr) {
	pMessageBox.Call(hwnd, uintptr(unsafe.Pointer(u16(texto))),
		uintptr(unsafe.Pointer(u16(titulo))), flags|mbTopmost|mbSetFg)
}

func traerAlFrente(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	pShowWindow.Call(hwnd, swRestore)
	pSetWindowPos.Call(hwnd, hwndTopmost, 0, 0, 0, 0, swpFlags)
	pSetWindowPos.Call(hwnd, hwndNoTop, 0, 0, 0, 0, swpFlags)
	pSetForeground.Call(hwnd)
	fi := flashInfo{hwnd: hwnd, dwFlags: flashAll | flashTimer}
	fi.cbSize = uint32(unsafe.Sizeof(fi))
	pFlashWindowEx.Call(uintptr(unsafe.Pointer(&fi)))
}

// ---------------- Sonido ----------------

var wavAlarma = generarWAV()

// Sirena de dos tonos (880 Hz / 1320 Hz), ~1.2 s, se repite en bucle.
func generarWAV() []byte {
	const rate = 22050
	var muestras []int16
	tono := func(freq float64, ms int) {
		n := rate * ms / 1000
		for i := 0; i < n; i++ {
			env := 1.0
			if i < 200 {
				env = float64(i) / 200
			} else if n-i < 200 {
				env = float64(n-i) / 200
			}
			v := math.Sin(2*math.Pi*freq*float64(i)/rate) * 0.9 * env
			muestras = append(muestras, int16(v*32767))
		}
	}
	silencio := func(ms int) {
		muestras = append(muestras, make([]int16, rate*ms/1000)...)
	}
	for k := 0; k < 2; k++ {
		tono(880, 220)
		silencio(40)
		tono(1320, 220)
		silencio(40)
	}
	silencio(200)

	datos := len(muestras) * 2
	b := make([]byte, 44+datos)
	copy(b[0:], "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(36+datos))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1) // PCM
	binary.LittleEndian.PutUint16(b[22:], 1) // mono
	binary.LittleEndian.PutUint32(b[24:], rate)
	binary.LittleEndian.PutUint32(b[28:], rate*2)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], uint32(datos))
	for i, m := range muestras {
		binary.LittleEndian.PutUint16(b[44+i*2:], uint16(m))
	}
	return b
}

func sonarAlarma() {
	r, _, _ := pPlaySound.Call(uintptr(unsafe.Pointer(&wavAlarma[0])), 0, sndMemory|sndAsync|sndLoop)
	if r == 0 { // respaldo si falla el audio
		go func() {
			for i := 0; i < 6; i++ {
				pBeep.Call(1000, 300)
				pBeep.Call(1500, 300)
			}
		}()
	}
}

func detenerSonido() { pPlaySound.Call(0, 0, 0) }

// ---------------- Estado de la clase ----------------

type Clase struct {
	Fecha  string `json:"fecha"`
	Nombre string `json:"nombre"`
	Min    string `json:"min"`
	Max    string `json:"max"`
}

type App struct {
	mu        sync.Mutex
	w         webview2.WebView
	cfg       Config
	clase     *Clase
	pausado   bool
	avisados  map[string]bool
	alarmando bool
}

// "16:55", "4:55 PM", "4:55 p. m." → hora de hoy
func parsearHora(s string) (time.Time, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	pm := strings.Contains(s, "p")
	am := strings.Contains(s, "a")
	limpio := strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || r == ':' {
			return r
		}
		return -1
	}, s)
	partes := strings.Split(limpio, ":")
	if len(partes) < 2 {
		return time.Time{}, false
	}
	h, e1 := strconv.Atoi(partes[0])
	m, e2 := strconv.Atoi(partes[1])
	if e1 != nil || e2 != nil || h > 23 || m > 59 {
		return time.Time{}, false
	}
	if pm && h < 12 {
		h += 12
	}
	if am && h == 12 {
		h = 0
	}
	n := time.Now()
	return time.Date(n.Year(), n.Month(), n.Day(), h, m, 0, 0, time.Local), true
}

// La fecha de la página es dd/mm/aaaa. Si no se puede leer, se asume hoy.
func esHoy(fecha string) bool {
	fecha = strings.TrimSpace(fecha)
	if fecha == "" {
		return true
	}
	for _, f := range []string{"02/01/2006", "2/1/2006", "2006-01-02"} {
		if t, err := time.ParseInLocation(f, fecha, time.Local); err == nil {
			y, m, d := time.Now().Date()
			ty, tm, td := t.Date()
			return y == ty && m == tm && d == td
		}
	}
	return true
}

func (a *App) hwnd() uintptr { return uintptr(a.w.Window()) }

func (a *App) evalJS(js string) { a.w.Dispatch(func() { a.w.Eval(js) }) }

func (a *App) disparar(clave, titulo, texto string, sirena bool) {
	a.mu.Lock()
	if a.avisados[clave] || a.alarmando {
		a.mu.Unlock()
		return
	}
	a.avisados[clave] = true
	a.alarmando = true
	a.mu.Unlock()

	if sirena {
		sonarAlarma()
	} else {
		go func() {
			for i := 0; i < 3; i++ {
				pBeep.Call(1200, 250)
				time.Sleep(150 * time.Millisecond)
			}
		}()
	}
	a.w.Dispatch(func() { traerAlFrente(a.hwnd()) })
	a.evalJS(fmt.Sprintf("window.__cuaBanner && window.__cuaBanner(%q)", titulo))

	go func() {
		mensaje(a.hwnd(), "CondUAlarma — "+titulo, texto+"\n\nPulsa Aceptar para detener la alarma.", mbOK|mbIconWarn)
		detenerSonido()
		a.mu.Lock()
		a.alarmando = false
		a.mu.Unlock()
		a.evalJS("window.__cuaBanner && window.__cuaBanner(null)")
	}()
}

func (a *App) vigilar() {
	for range time.Tick(2 * time.Second) {
		a.mu.Lock()
		c := a.clase
		a.mu.Unlock()
		if c == nil || !esHoy(c.Fecha) {
			continue
		}
		min, ok1 := parsearHora(c.Min)
		max, ok2 := parsearHora(c.Max)
		if !ok1 {
			continue
		}
		if !ok2 {
			max = min.Add(20 * time.Minute)
		}
		ahora := time.Now()
		clave := c.Fecha + "|" + c.Min
		if !ahora.Before(min) && ahora.Before(max) {
			a.disparar(clave+"|abre", "¡VALIDACIÓN ABIERTA!",
				fmt.Sprintf("Ya se puede registrar la huella.\n%s\nVentana: %s a %s",
					c.Nombre, c.Min, c.Max), true)
		}
		aviso := max.Add(-5 * time.Minute)
		if aviso.After(min) && !ahora.Before(aviso) && ahora.Before(max) {
			a.disparar(clave+"|cierra", "Quedan 5 minutos para validar",
				fmt.Sprintf("La validación cierra a las %s.", c.Max), false)
		}
	}
}

func main() {
	app := &App{cfg: cargarConfig(), avisados: map[string]bool{}}

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  filepath.Join(carpetaApp(), "navegador"), // guarda la sesión/cookies
		WindowOptions: webview2.WindowOptions{
			Title:  "CondUAlarma — Aulapp",
			Width:  1280,
			Height: 800,
			Center: true,
			IconId: 1,
		},
	})
	if w == nil {
		mensaje(0, "CondUAlarma",
			"No se pudo iniciar el navegador.\n\nInstala \"Microsoft Edge WebView2 Runtime\" desde la página de Microsoft y vuelve a abrir CondUAlarma.",
			mbOK|mbIconWarn)
		return
	}
	defer w.Destroy()
	app.w = w

	// --- Funciones que la página puede llamar ---
	w.Bind("cuaReportar", func(c Clase) {
		if strings.TrimSpace(c.Min) == "" {
			return
		}
		app.mu.Lock()
		app.clase = &c
		app.mu.Unlock()
	})
	w.Bind("cuaEstado", func() map[string]interface{} {
		app.mu.Lock()
		defer app.mu.Unlock()
		return map[string]interface{}{
			"pausado":  app.pausado,
			"clase":    app.clase,
			"segundos": recargaSegundos,
			"url":      app.cfg.URL,
		}
	})
	w.Bind("cuaPausar", func(p bool) {
		app.mu.Lock()
		app.pausado = p
		app.mu.Unlock()
	})
	w.Bind("cuaProbar", func() {
		sonarAlarma()
		go func() {
			mensaje(app.hwnd(), "CondUAlarma — Prueba", "Así suena la alarma.\n\nPulsa Aceptar para detenerla.", mbOK|mbIconInfo)
			detenerSonido()
		}()
	})
	w.Bind("cuaGuardarURL", func(u string) {
		u = strings.TrimSpace(u)
		if u == "" {
			return
		}
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			u = "https://" + u
		}
		app.mu.Lock()
		app.cfg.URL = u
		guardarConfig(app.cfg)
		app.mu.Unlock()
		w.Dispatch(func() { w.Navigate(u) })
	})
	w.Bind("cuaConfigurar", func() {
		w.Dispatch(func() { w.SetHtml(strings.ReplaceAll(setupHTML, "{{URL}}", app.cfg.URL)) })
	})
	w.Bind("cuaInicio", func() {
		if app.cfg.URL != "" {
			w.Dispatch(func() { w.Navigate(app.cfg.URL) })
		}
	})

	w.Init(injectJS)

	if app.cfg.URL == "" {
		w.SetHtml(strings.ReplaceAll(setupHTML, "{{URL}}", ""))
	} else {
		w.Navigate(app.cfg.URL)
	}

	go app.vigilar()
	w.Run()
}
