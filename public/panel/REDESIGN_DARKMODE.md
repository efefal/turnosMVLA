# Plan — Dark/Light mode en el panel
# Alcance de corrección de hardcodeos aprobado: categorías A + B + C
# (overlays de modal, texto JS ya documentado como deuda, clases
# compartidas de audit/role/counter/banner). Categoría D
# (dashboard.html — gráficos SVG) queda fuera, documentada como
# limitación conocida de esta primera versión.

---

## Contexto

El panel tiene hoy un único tema (oscuro), con el sistema de tokens
completo en `design-tokens.css`. El objetivo es agregar un modo claro
alternable por el usuario, persistente entre sesiones (`localStorage`,
a diferencia del JWT que usa `sessionStorage` a propósito).

**Hallazgo clave del análisis que reordena el trabajo:** no alcanza con
overridear `:root`. Hay ~28 reglas CSS (19 en `design-tokens.css` mismo:
`.audit-*`, `.role-*`, `.counter-*`, `.banner-en-atencion`,
`.dot-atencion`, `.btn-primary:hover`, `.toggle.inactive::after`,
`.search-global-resultados`; más 8 en `auditoria.html` y 1 en
`bloqueos.html`) que hardcodean el color en vez de referenciar la
variable semántica que ya existe para ese propósito (`--audit-create`,
`--role-encargado`, etc. — variables que hoy tienen **cero** referencias
`var()` reales). Corregir esto no es opcional para que el modo claro
funcione en los badges de auditoría, badges de rol, contadores del
topbar y el banner "En Atención" — es la categoría C del análisis, y
queda dentro del alcance aprobado.

**Fuera de alcance (categoría D, documentada como limitación):**
`dashboard.html` tiene un sistema de color propio para sus gráficos SVG
(`COLORES_CANAL`, `COLORES_ESTADO`, colores hardcodeados dentro de
`svgBarras()`) completamente al margen del design system. Los gráficos
de barras y las leyendas de canal/estado del dashboard **no van a
cambiar de tema** en esta versión.

---

## 1. Paleta de modo claro — propuesta completa

Mantiene el mismo propósito semántico de cada token. Los acentos
(teal/blue/amber/red) se oscurecen respecto del original porque los
valores actuales están calibrados para contraste sobre fondo oscuro
(`#2dd4a0` sobre blanco tiene contraste insuficiente para texto). Las
variantes `-dim`/`-mid` reutilizan el mismo tono oscurecido en baja
opacidad, así que heredan el ajuste automáticamente.

**Esta paleta es una propuesta de partida, no un valor final.** Por
eso el plan (§4) prioriza pilotearla en 2 páginas antes de propagarla
a las 10 — los tonos exactos se van a poder ajustar mirándolos
renderizados, sin tener que deshacer trabajo en el resto del panel.

```css
:root[data-theme="light"] {

  /* ── Fondos ────────────────────────────────────────────────── */
  --bg-0: #eef2f7;        /* base de la app */
  --bg-1: #ffffff;        /* sidebar */
  --bg-2: #f6f9fc;        /* área de contenido principal */
  --bg-3: #ffffff;        /* cards, paneles, tablas */
  --bg-4: #e9eff6;        /* elementos elevados, toggles, heatmap vacío */

  /* ── Bordes ────────────────────────────────────────────────── */
  --border:    #dde5ef;
  --border-hi: #b7c6d9;

  /* ── Teal ──────────────────────────────────────────────────── */
  --teal:      #0f8a67;
  --teal-dim:  rgba(15, 138, 103, 0.10);
  --teal-mid:  rgba(15, 138, 103, 0.22);
  --teal-hm-1: rgba(15, 138, 103, 0.16);
  --teal-hm-2: rgba(15, 138, 103, 0.46);

  /* ── Blue ──────────────────────────────────────────────────── */
  --blue:      #1d6fd8;
  --blue-dim:  rgba(29, 111, 216, 0.10);
  --blue-mid:  rgba(29, 111, 216, 0.22);

  /* ── Amber ─────────────────────────────────────────────────── */
  --amber:     #b5700a;
  --amber-dim: rgba(181, 112, 10, 0.10);
  --amber-mid: rgba(181, 112, 10, 0.22);

  /* ── Red ───────────────────────────────────────────────────── */
  --red:       #d13b3b;
  --red-dim:   rgba(209, 59, 59, 0.10);
  --red-mid:   rgba(209, 59, 59, 0.22);

  /* ── Texto ─────────────────────────────────────────────────── */
  --text-1: #16293b;      /* texto principal */
  --text-2: #52697d;      /* texto secundario / metadatos */
  --text-3: #8ea0b3;      /* texto deshabilitado / labels de sección */

  /* ── Estados de día — fondos de header ───────────────────────── */
  --day-hdr-normal:   transparent;
  --day-hdr-today:    rgba(15, 138, 103, 0.07);
  --day-hdr-blocked:  rgba(29, 111, 216, 0.07);
  --day-hdr-holiday:  rgba(209, 59, 59, 0.08);
  --day-hdr-closed:   rgba(0, 0, 0, 0.045);

  /* ── Estados de día — fondos de celda ────────────────────────── */
  --day-bg-normal:    transparent;
  --day-bg-today:     rgba(15, 138, 103, 0.035);
  --day-bg-blocked:   rgba(29, 111, 216, 0.035);
  --day-bg-holiday:   rgba(209, 59, 59, 0.045);
  --day-bg-closed:    rgba(0, 0, 0, 0.035);

  /* Estados de día — color de texto: siguen apuntando a --text-2,
     --teal, --blue, --red, --text-3 vía var() en la definición
     original — no hace falta redeclararlos acá, heredan solos. */

  /* ── Cards de turno ───────────────────────────────────────────── */
  --turno-blue-bg:   rgba(29, 111, 216, 0.10);
  --turno-blue-ring: rgba(29, 111, 216, 0.25);
  --turno-blue-tx:   #1d6fd8;

  --turno-teal-bg:   rgba(15, 138, 103, 0.10);
  --turno-teal-ring: rgba(15, 138, 103, 0.22);
  --turno-teal-tx:   #0f8a67;

  --turno-red-bg:    rgba(209, 59, 59, 0.10);
  --turno-red-ring:  rgba(209, 59, 59, 0.25);
  --turno-red-tx:    #d13b3b;

  /* Auditoría y roles: no se redeclaran, ya apuntan vía var() a
     teal/blue/amber/red/text-2 en la definición original. Su
     corrección real es la de categoría C (§ más abajo): que las
     CLASES que los consumen referencien estas variables en vez de
     hardcodear el rgba(). */

  /* ── Overlay del drawer / modales ─────────────────────────────── */
  --drawer-overlay: rgba(15, 23, 35, 0.45);

  /* ── Líneas de hora en calendario ─────────────────────────────── */
  --hora-line-full:  var(--border);
  --hora-line-half:  rgba(180, 195, 214, 0.5);

  /* ── Bloqueo — marca de agua diagonal ─────────────────────────── */
  --blocked-stripe: repeating-linear-gradient(
    -45deg,
    transparent 10px,
    rgba(29, 111, 216, 0.06) 20px
  );
  --blocked-watermark-color: rgba(29, 111, 216, 0.16);

  /* ── Sombra de scroll personalizado ───────────────────────────── */
  --scrollbar-thumb: rgba(15, 138, 103, 0.25);
}
```

**Nueva variable (no existía, se agrega para categoría A):**

```css
:root {
  --modal-overlay: rgba(0, 0, 0, 0.45);   /* valor actual, sin cambios */
}
:root[data-theme="light"] {
  --modal-overlay: rgba(15, 23, 35, 0.35);
}
```

Reemplaza los `rgba(0,0,0,.45)` / `rgba(0,0,0,.5)` / `rgba(0,0,0,.55)`
hardcodeados en `.modal-fondo`/`.modal-caja` de `areas.html`,
`servicios-admin.html`, `usuarios.html`, `agenda.html`, `login.html`,
`auditoria.html` (9 ocurrencias, categoría A) — de paso unifica 3
valores de opacidad ligeramente distintos (`.45`, `.5`, `.55`) que
hoy conviven sin motivo aparente en un solo token.

---

## 2. Mecanismo técnico

### 2.1 — Atributo + selector CSS

`data-theme="light"` en `<html>`, ausente = oscuro (comportamiento
actual sin cambios). En `design-tokens.css`:

```css
:root { /* valores oscuros actuales, sin tocar */ }
:root[data-theme="light"] { /* overrides de §1 */ }
```

### 2.2 — Precedente de JS compartido: no existe

Confirmé que **no hay ningún `.js` externo** en el panel — las 10
páginas no tienen `<script src="...">`, todo vive inline en el
`<script>` de cada HTML, duplicado página por página (`getToken`,
`apiFetch`, `esc`, `mostrarAlerta`, etc. se repiten literalmente en
cada archivo). Es el mismo patrón que ya se sigue para todo lo demás.

**Decisión: seguir el precedente, no introducir el primer `.js`
compartido del panel.** La lógica de tema son ~20 líneas, más chica
que el bloque de auth ya duplicado en cada página. Introducir un
archivo compartido ahora, solo para esto, generaría una asimetría
rara (todo inline excepto una cosa) sin ahorro real que lo justifique.

### 2.3 — Persistencia

`localStorage.setItem('panel_tema', 'light' | 'dark')`. Primer uso
legítimo de `localStorage` en el panel (confirmado en el análisis: no
hay ningún uso existente en código vivo).

### 2.4 — Evitar flash de tema incorrecto

Como el JS que aplica el tema vive en el `<script>` de siempre (al
final del `<body>` o en un IIFE `init()`), si solo ahí se lee
`localStorage`, el navegador pintaría primero con la paleta oscura
por defecto y recién después saltaría a clara — flash visible.

**Solución: script inline mínimo en `<head>`, antes del
`<link rel="stylesheet">` de `design-tokens.css`,** que solo hace
esto (sin dependencias, sin esperar a nada):

```html
<script>
  (function() {
    if (localStorage.getItem('panel_tema') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  })();
</script>
<link rel="stylesheet" href="/assets/design-tokens.css">
```

Este bloque es el único código de tema que va **antes** del CSS. El
resto (función de toggle, actualización del botón) vive en el
`<script>` principal de siempre, al final de la página.

---

## 3. Toggle visual

**Ubicación:** dentro de `.sidebar-footer`, arriba del botón "Salir"
existente (que hoy es el único elemento ahí). Incluir su propio botón
del mismo ancho/estilo, para que se lea como un par de acciones de
pie de sidebar, no como un control suelto:

```html
<div class="sidebar-footer">
  <button class="btn-tema-toggle" id="btn-tema" onclick="toggleTema()">
    <span id="texto-tema">Modo claro</span>
  </button>
  <button class="btn-logout-sidebar" onclick="cerrarSesion()">Salir</button>
</div>
```

**Texto, no ícono.** El resto del panel usa texto plano en los botones
del sidebar-footer (`Salir`, sin ícono) — mantengo esa consistencia en
vez de sumar un emoji/SVG nuevo que no tiene precedente en el design
system. El label describe la **acción** (a qué modo cambia al hacer
clic), no el estado actual — evita ambigüedad:

- Tema oscuro activo → botón dice **"Modo claro"**
- Tema claro activo → botón dice **"Modo oscuro"**

**CSS nuevo (`.btn-tema-toggle`)** — calcado de `.btn-logout-sidebar`,
mismo tamaño y comportamiento, sin colores nuevos:

```css
.btn-tema-toggle {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-2);
  padding: 5px 10px;
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  cursor: pointer;
  width: 100%;
  margin-bottom: 6px;
  transition: var(--transition-fast);
}
.btn-tema-toggle:hover {
  background: var(--bg-4);
  border-color: var(--border-hi);
  color: var(--text-1);
}
```

---

## 4. Alcance de la primera versión — piloto en 2 páginas

**Piloto: `agenda.html` + `usuarios.html`.**

- `agenda.html` es la página más compleja y la más usada: ejercita
  calendario (`day-*`), cards de turno (`turno-*`), drawer, chips de
  filtro, banner "En Atención", buscador global — la mayor superficie
  de tokens de una sola página.
- `usuarios.html` ejercita tablas, modales, formularios, y sobre todo
  `.role-badge` (categoría C) y sus 3 hardcodeos de categoría B
  (`#64748b`, `#94a3b8` ×2, `#dc2626`) — la página administrativa de
  referencia.

Entre las dos cubren la gran mayoría de los 64 tokens de color y las
tres categorías de hardcodeo aprobadas para corregir.

**Por qué no las 10 de entrada:** si algún tono de la paleta de §1 no
funciona bien en la práctica (contraste, legibilidad, "se ve
desteñido"), corregirlo en `design-tokens.css` no cuesta nada extra
sin importar cuántas páginas ya tengan el toggle — pero si además hay
que ajustar alguna clase específica de una página, es mejor haber
tocado 2 archivos que 10. Una vez validado visualmente, propagar el
botón + el script de `<head>` a las 8 páginas restantes es mecánico
y de bajo riesgo (Paso 3 más abajo).

**Efecto secundario esperado y aceptado durante el piloto:** si el
usuario cambia a modo claro en `agenda.html` y navega a una página
que todavía no tiene el script de `<head>` (por ejemplo `bloqueos.html`
en este momento del plan), esa página va a mostrarse en oscuro —
`localStorage` ya tiene el valor guardado, pero esa página en
particular no lo lee todavía. No es un bug, es el estado esperado
mientras el piloto no se propaga. Al llegar al Paso 3 esto desaparece
en las 10 páginas.

---

## 5. Limitaciones conocidas

1. **`dashboard.html` — gráficos SVG (categoría D, fuera de alcance).**
   `COLORES_CANAL`, `COLORES_ESTADO` y los colores inline dentro de
   `svgBarras()` no leen el tema. Los gráficos de barras, el gráfico de
   canal de origen y sus leyendas se van a seguir viendo con los
   mismos tonos sin importar el modo. Documentado para una eventual
   Fase 2 de dark mode, no de esta.

2. **Página del piloto que falte propagar.** Hasta que el Paso 3 esté
   commiteado, `bloqueos.html`, `presencial.html`, `dashboard.html`,
   `auditoria.html`, `servicios-admin.html`, `areas.html`,
   `login.html` y `cambiar-clave.html` no van a tener el toggle
   visible ni van a leer el tema guardado (ver efecto secundario en §4).

3. **Sin transición animada entre temas.** El cambio es instantáneo
   (no hay `transition` sobre `background`/`color` a nivel global
   agregado para esto). Se puede sumar después si se pide, pero no es
   parte de este plan — agregar transiciones globales a `*` tiene
   riesgo de efectos secundarios visuales en elementos que ya animan
   otras propiedades (`.turno-card`, `.toggle`, etc.).

---

## 6. Orden de implementación

### Paso 1 — Fundaciones: paleta + mecanismo + categorías A y C (compartidas)

- `design-tokens.css`: agregar bloque `:root[data-theme="light"]` completo (§1)
- `design-tokens.css`: agregar `--modal-overlay` (dark + light) y aplicarlo en el propio archivo si corresponde (no hay `.modal-fondo` genérico ahí — se aplica página por página en el paso 2/3)
- `design-tokens.css`: refactor categoría C — reemplazar el `rgba()`/hex hardcodeado por `var()` en `.audit-*` (5 reglas), `.role-*` (5), `.counter-*` (4), `.banner-en-atencion` (2 props), `.dot-atencion` (1), `.btn-primary:hover` (1), `.toggle.inactive::after` (1), `.search-global-resultados` box-shadow (1) — sin cambiar el valor final en modo oscuro (mismo rgba de siempre, solo referenciado vía variable)
- Checkpoint: con el toggle todavía sin existir en ningún HTML, forzar `document.documentElement.setAttribute('data-theme','light')` manualmente desde la consola del navegador en 2-3 páginas y verificar visualmente que nada rompe y que audit-badge/role-badge/counter-*/banner-en-atencion cambian de color
- Commit: `feat(panel): paleta de modo claro + fix categoria C de colores hardcodeados en design-tokens.css`

### Paso 2 — Piloto: toggle en agenda.html + usuarios.html

- Agregar script de `<head>` (§2.4) en ambas páginas
- Agregar botón + CSS `.btn-tema-toggle` (§3) en ambas páginas
- Agregar `toggleTema()` al `<script>` principal de ambas páginas
- `usuarios.html`: fix categoría B — reemplazar los 4 hardcodeos JS (`#64748b` ×3, `#94a3b8` ×2, `#dc2626` ×1) por las clases utilitarias ya existentes en `design-tokens.css` (`.text-secondary`, `.text-muted`, `.text-red` — no hace falta CSS nuevo)
- Checkpoint: alternar tema en ambas páginas, revisar visualmente calendario, drawer, turno-cards, banner, tablas, modal, role-badge en ambos modos; confirmar persistencia recargando la página; confirmar que `localStorage.panel_tema` se actualiza
- Commit: `feat(panel): toggle dark/light mode en agenda y usuarios (piloto)`

### Paso 3 — Propagación a las 8 páginas restantes

- Agregar script de `<head>` + botón + CSS + `toggleTema()` en: `presencial.html`, `bloqueos.html`, `dashboard.html`, `auditoria.html`, `servicios-admin.html`, `areas.html`, `login.html`, `cambiar-clave.html`
- `bloqueos.html`: fix categoría B (2 hardcodeos) + categoría C local (`.chip-existente`)
- `auditoria.html`: fix categoría B (3 hardcodeos) + categoría C local (8 reglas `.accion-*`)
- `servicios-admin.html`: fix categoría B (3 hardcodeos, ya identificados en la sesión de `areas.html`)
- Checkpoint: alternar tema en las 10 páginas, navegar entre todas verificando que el tema persiste sin flash ni reset, grep final de hex/rgba hardcodeado remanente (debe bajar de ~67 a solo la categoría D en `dashboard.html`, documentada)
- Commit: `feat(panel): propagar toggle dark/light mode a las 8 paginas restantes + fix categorias A/B/C`

### Paso 4 — Verificación de cierre

- Confirmar `localStorage.panel_tema` es el único uso de `localStorage` en el panel (sigue siendo cierto, no se coló nada más)
- Confirmar que `sessionStorage` (JWT) no se tocó
- Actualizar `CLAUDE.md`: marcar el ítem "Dark/Light mode toggle" de "Próximos pasos" como completado, y agregar nota breve sobre la limitación de `dashboard.html`
