# Plan de rediseño — cambiar-clave.html
# Referencia: design_handoff_sistema_turnos/README.md § tokens globales
# Restricciones: Vanilla JS · no tocar lógica JS · solo vars de design-tokens.css

---

## Contexto: página de auth, no página de panel

`cambiar-clave.html` es una página del flujo de autenticación, **no una página de panel con sidebar**.
No tiene navegación lateral. Su layout es: fondo a pantalla completa + tarjeta centrada.

Esto la diferencia de agenda, presencial y bloqueos. El rediseño consiste en:
1. Importar `design-tokens.css` (provee reset, fondo oscuro, fuente — sin redefinir nada de eso).
2. Reemplazar colores hardcodeados por tokens en el `<style>` interno.
3. Cambiar la clase del botón de `.btn-guardar` a `.btn.btn-primary.btn-full`.

---

## 1. Inventario de IDs obligatorios

Todos son leídos o escritos por el JS y deben sobrevivir intactos.

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `aviso-obligatorio` | script inline | `style.display = 'block'` cuando `panel_debe_cambiar_clave === 'true'` |
| `form-cambio` | script inline | `addEventListener('submit', ...)` |
| `error` | `mostrarError()`, submit handler | `.textContent` + `style.display = 'block'` / `'none'` |
| `clave-nueva` | submit handler | `.value` leído |
| `clave-confirmar` | submit handler | `.value` leído |
| `btn-submit` | submit handler | `.disabled` + `.textContent` |

> **Nota sobre visibilidad:** `.aviso` y `.error` son controlados con `style.display` directamente
> (no con toggle de clase). No modificar este mecanismo — solo cambiar los colores en CSS.
> `#aviso-obligatorio` tiene `style="display:none"` en el HTML estático; `#error` tiene
> `display: none` en su regla CSS. Ambos mecanismos deben conservarse tal cual.

---

## 2. Clases CSS generadas dinámicamente por JS

**Ninguna.** El JS no inyecta HTML ni modifica clases. Solo manipula propiedades directas:
- `style.display` en `#aviso-obligatorio` y `#error`
- `.disabled` y `.textContent` en `#btn-submit`

---

## 3. Funciones JS: presentación vs. lógica de negocio

### Lógica de negocio — NO MODIFICAR
| Bloque / función | Por qué no se toca |
|---|---|
| Verificación de `panel_token` (guard al cargar) | Auth |
| Muestra de `#aviso-obligatorio` por `panel_debe_cambiar_clave` | Lógica de sesión |
| `mostrarError(msg)` | Función de estado — solo cambia colores vía CSS |
| `form.addEventListener('submit', ...)` | Validaciones + fetch POST a `/panel/auth/cambiar-clave` |

### Presentación — cambios permitidos (solo HTML, no JS)
| Elemento | Qué se puede cambiar |
|---|---|
| `<button class="btn-guardar">` | Cambiar clase a `btn btn-primary btn-full` — el JS lo accede por ID, no por clase |

---

## 4. Mapeo de colores hardcodeados → tokens

### En el bloque `<style>` interno

| Elemento | Valor actual | Token equivalente |
|---|---|---|
| `body { font-family: system-ui... }` | → **DELETE** | `design-tokens.css` aplica `var(--font-ui)` a `html,body` |
| `body { background: #1A3C4B }` | → **DELETE** | `design-tokens.css` aplica `var(--bg-0)` a `html,body` |
| Bloque `*, *::before, *::after` completo | → **DELETE** | idéntico al reset de `design-tokens.css` — redundante |
| `.card { background: white }` | blanco | `var(--bg-3)` |
| `.card { box-shadow: 0 20px 60px rgba(0,0,0,.35) }` | sombra pesada | `border: 1px solid var(--border)` |
| `.encabezado { border-bottom: 1px solid #f1f5f9 }` | gris claro | `var(--border)` |
| `.encabezado h1 { color: #1A3C4B }` | teal marca | `var(--teal)` |
| `.encabezado h1 { font-family: 'Trebuchet MS'... }` | fuente vieja | → **DELETE** (hereda `var(--font-ui)` del reset) |
| `.aviso { background: #fefce8 }` | amarillo claro | `var(--amber-dim)` |
| `.aviso { border: 1px solid #fde047 }` | amarillo | `var(--amber-mid)` |
| `.aviso { color: #854d0e }` | ámbar oscuro | `var(--amber)` |
| `label { color: #374151 }` | gris | `var(--text-2)` |
| `input { border: 1px solid #d1d5db }` | borde gris | `var(--border)` |
| `input { background }` | default browser | `var(--bg-4)` |
| `input { color }` | default browser | `var(--text-1)` |
| `input { font-family: inherit }` | → **DELETE** | `design-tokens.css` define `select, input { font-family: var(--font-ui); }` |
| `input:focus { border-color: #1A3C4B }` | teal | `var(--border-hi)` |
| `input:focus { box-shadow: rgba(26,60,75,.12) }` | teal shadow | `var(--teal-dim)` |
| `.error { background: #fef2f2 }` | rojo claro | `var(--red-dim)` |
| `.error { border: 1px solid #fecaca }` | rojo borde | `var(--red-mid)` |
| `.error { color: #991b1b }` | rojo | `var(--red)` |
| `.btn-guardar { background: #1A3C4B }` | teal | → clase eliminada, usar `.btn.btn-primary.btn-full` |
| `.btn-guardar { color: white }` | blanco | → ídem |
| `.btn-guardar:hover { opacity: 0.88 }` | opacity hover | → `.btn-primary:hover` en tokens maneja hover |
| `.btn-guardar:disabled { opacity: 0.5 }` | disabled | → agregar `.btn:disabled` localmente (no está en tokens) |
| `.pie { color: #94a3b8 }` | gris suave | `var(--text-3)` |

### En el HTML estático

| Elemento | Cambio |
|---|---|
| `<button type="submit" class="btn-guardar" id="btn-submit">` | → `class="btn btn-primary btn-full"` |
| `<img src="/assets/Logo%20mvla%202024%20%201%20color%20h.jpg">` | → Ver §6 (nota sobre logo) |

> **Por qué es seguro cambiar la clase del botón:** el JS lo accede por `id="btn-submit"`.
> El atributo `class` no es leído ni modificado por el script.

---

## 5. Qué cubre design-tokens.css (no hay que redefinir)

| Uso | Clase / regla de tokens |
|---|---|
| Reset `*, *::before, *::after` | ya en tokens → eliminar bloque local |
| `body { font-family, background, color, font-size }` | ya en `html, body { ... }` de tokens → DELETE en local |
| `input, select { font-family }` | ya en tokens (línea ~207) → DELETE del CSS local |
| `button { cursor, font-family }` | ya en tokens → DELETE |
| `.btn.btn-primary` — fondo teal, color, hover | definido en tokens → usar directamente |
| Bordes redondeados (`--radius-md`, `--radius-lg`) | token |
| Colores semánticos (teal, red, amber, etc.) | tokens |

---

## 6. Logo — archivo correcto

El JPEG original (`Logo mvla 2024  1 color h.jpg`) fue descartado porque no tiene canal alfa.
`Logo mvla 2024 color y sombra.png` también fue descartado — su sombra negra desaparece
sobre fondo oscuro (verificado durante el rediseño de login.html).

**Archivo correcto:** `escudo_vla_web_color.png`
- Canal RGBA con píxeles claros sobre fondo transparente
- Ya verificado y en uso en login.html
- Es un escudo cuadrado → `max-width: 80px` (no 200px del logo horizontal)

**Cambios del Paso 1:**
```html
<img src="/assets/escudo_vla_web_color.png" alt="Municipalidad de Villa La Angostura">
```
```css
.encabezado img { max-width: 80px; ... }
```

No se necesita `mix-blend-mode`.

---

## 7. CSS nuevo para el `<style>` interno

Solo lo que `design-tokens.css` no cubre. Sin ningún hex hardcodeado.

```css
/* ── Body: layout centrado (fondo y fuente vienen de design-tokens.css) ── */
body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

/* ── Card ────────────────────────────────────────────────────── */
.card {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 2.5rem;
  width: 100%;
  max-width: 420px;
}

/* ── Encabezado ──────────────────────────────────────────────── */
.encabezado {
  text-align: center;
  margin-bottom: 1.75rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
}
.encabezado img {
  max-width: 200px;
  height: auto;
  display: block;
  margin: 0 auto 1rem;
}
.encabezado h1 {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--teal);
}

/* ── Aviso de contraseña temporal ────────────────────────────── */
.aviso {
  background: var(--amber-dim);
  border: 1px solid var(--amber-mid);
  color: var(--amber);
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin-bottom: 1.25rem;
}

/* ── Formulario ──────────────────────────────────────────────── */
.form-grupo { margin-bottom: 1.1rem; }
label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: 0.4rem;
}
input {
  width: 100%;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  background: var(--bg-4);
  color: var(--text-1);
  transition: var(--transition-fast);
}
input::placeholder { color: var(--text-3); }
input:focus {
  border-color: var(--border-hi);
  box-shadow: 0 0 0 3px var(--teal-dim);
}

/* ── Alerta de error (JS usa style.display, no clase) ─────────── */
.error {
  background: var(--red-dim);
  border: 1px solid var(--red-mid);
  color: var(--red);
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin-bottom: 1rem;
  display: none;
}

/* ── Botón ancho completo + estado disabled ───────────────────── */
.btn-full { width: 100%; justify-content: center; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Pie de página ───────────────────────────────────────────── */
.pie {
  text-align: center;
  margin-top: 1.25rem;
  font-size: var(--text-xs);
  color: var(--text-3);
}
```

---

## 8. Orden de implementación (pasos con checkpoint)

### ~~Paso 1 — Importar tokens + reemplazar CSS y HTML~~ ✅ completado (commit `2a5e227`)

- ~~Agregar `<link rel="stylesheet" href="/assets/design-tokens.css">` en `<head>` antes del `<style>`~~
- ~~Eliminar del `<style>` interno:~~
  - ~~Bloque `*, *::before, *::after { ... }` completo (redundante con tokens)~~
  - ~~`font-family: system-ui...` del body (tokens lo provee)~~
  - ~~`background: #1A3C4B` del body (tokens lo provee)~~
- ~~Reemplazar el `<style>` interno con el CSS de §7~~
- ~~HTML — botón: `class="btn-guardar"` → `class="btn btn-primary btn-full"`~~
- ~~HTML — logo: cambiar JPEG por `escudo_vla_web_color.png` (`max-width: 80px`)~~
- **Verificado:** 0 hex en archivo completo; `.btn-guardar` eliminado; 6 IDs obligatorios presentes; `body` → `var(--bg-0)` + `var(--font-ui)`; `.card` → `var(--bg-3)`; `#btn-submit` → `var(--teal)`; `#error` → `var(--red-dim)` con `display:none`; logo `escudo_vla_web_color.png` a 80px

### ~~Paso 2 — Verificación final~~ ✅ completado — rediseño FINALIZADO

- ~~Grep definitivo: 0 resultados — ningún hex en el archivo completo~~
- ~~Logo `escudo_vla_web_color.png` verificado visualmente sobre fondo oscuro — aprobado~~
- **Verificado:** 0 hex; logo legible; formulario funcional

### Commit por paso
`feat(panel): cambiar-clave paso N — descripción`
