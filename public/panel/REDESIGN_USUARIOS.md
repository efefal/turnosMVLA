# Plan de rediseño — usuarios.html
# Referencia: design_handoff_sistema_turnos/README.md § "ABM Usuarios"
# Restricciones: Vanilla JS · no tocar lógica JS · solo vars de design-tokens.css

---

## Contexto

`usuarios.html` gestiona el ABM de usuarios del panel. Contiene:
- Navbar superior (a reemplazar por sidebar idéntico al de los otros paneles)
- Card: tabla de usuarios con selector B9 de área
- Card: formulario de nuevo usuario con checkboxes de área (B2) y campo atiende_turnos (B3)
- Modal de edición: datos básicos + B2+B3 + grilla semanal de horarios (B4)
- Modal de reseteo de contraseña (solo rol sistemas)

**Diferencias clave respecto a los otros paneles rediseñados:**
1. **Dos funciones badge**: `rolBadgeHTML()` (sidebar) y `badgeRol()` (tabla) — ambas usan inline styles. Ambas son presentación pura y se reescriben.
2. **`.btn-ghost` en template string** de `renderUsuarios()` (L494): el JS genera `class="btn btn-ghost btn-sm"` dinámicamente. No se puede renombrar a `btn-secondary` sin tocar lógica. Se mantiene `.btn-ghost` en CSS local con estilos de tokens. Los botones `.btn-ghost` del HTML estático SÍ se renombran a `.btn-secondary`.
3. **Toggle activo/inactivo**: el README §5 describe un toggle visual. El JS actual usa `<select id="edit-activo">`. No se implementa el toggle — se mantiene el `<select>` y se estiliza con tokens. El badge en la tabla (`.badge-activo`/`.badge-inactivo`) se mantiene.
4. **`.btn-success` es leído por JS**: `document.querySelector('#seccion-horarios .btn-success')`. No renombrar esa clase.
5. **Muchos inline styles en HTML estático**: hay asteriscos de campo requerido, textos de modal y display del reset que se extraen a clases.

---

## 1. Inventario de IDs obligatorios

### Sidebar

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `nav-nombre` | `init()` | inyecta `nombre + rolBadgeHTML()` |
| `sidebar-avatar` | `init()` — **agregar** | iniciales + color según rol |
| `label-reportes` | `init()` — **agregar** | muestra label "Reportes" |
| `label-admin` | `init()` — **agregar** | muestra label "Admin." |
| `nav-auditoria` | `init()` | muestra via `style.display` |
| `nav-dashboard` | `init()` | muestra via `style.display` |
| `nav-servicios` | `init()` | muestra via `style.display` |

> "Usuarios" en el sidebar es `.nav-item.active` hardcodeado — sin ID, siempre visible.

### B9 — Chips de área (lista de usuarios)

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `selector-areas-usu` | `inicializarChipsUsuarios()` | agrega clase `.visible` |
| `chips-areas-usu` | `inicializarChipsUsuarios()` | inserta `<span class="area-chip">` |

> Nombres distintos a los de auditoria.html. No intercambiar.

### Tabla / alertas de lista

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `error-lista` | `mostrarAlerta()` | toggle `.visible` + textContent |
| `ok-lista` | `mostrarAlerta()` | toggle `.visible` + textContent + auto-hide 4s |
| `tbody-usuarios` | `renderUsuarios()`, `cargarUsuarios()` | `.innerHTML` con filas |

### Formulario nuevo usuario

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `card-nuevo-usuario` | `init()` | `style.display = 'none'` si directivo |
| `nuevo-nombre` | `crearUsuario()` | `.value` leído |
| `nuevo-email` | `crearUsuario()` | `.value` leído |
| `nuevo-password` | `crearUsuario()` | `.value` leído / borrado |
| `nuevo-rol` | `crearUsuario()`, `onNuevoRolChange()`, `init()` | `.value` + append option |
| `hint-rol-nuevo` | `onNuevoRolChange()` | `.textContent` |
| `nuevo-areas-seccion` | `onNuevoRolChange()` | `style.display` |
| `nuevo-areas-lista` | `construirAreaCheckboxes()`, `leerAreasSeleccionadas()` | innerHTML dinámico |
| `error-form` | `mostrarAlerta()` | toggle `.visible` |

### Modal de edición

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `modal-fondo` | `abrirModal()`, `cerrarModal()`, `init()` | toggle clase `.abierto` |
| `modal-titulo` | `abrirModal()` | `.textContent` |
| `error-modal` | `mostrarAlertaModal()` | toggle `.visible` |
| `edit-nombre` | `abrirModal()`, `guardarEdicion()`, `resetearClaveDesdeModal()` | `.value` |
| `edit-rol` | `abrirModal()`, `guardarEdicion()`, `onEditRolChange()`, `init()` | `.value` + append |
| `edit-activo` | `abrirModal()`, `guardarEdicion()` | `.value` (`'1'`/`'0'`) |
| `btn-resetear-en-modal` | `abrirModal()` | `style.display` toggle |
| `edit-areas-seccion` | `abrirModal()`, `onEditRolChange()` | `style.display` |
| `edit-areas-lista` | `construirAreaCheckboxes()`, `leerAreasSeleccionadas()`, `actualizarSeccionHorarios()`, `cargarServiciosParaHorarios()` | innerHTML dinámico |
| `seccion-horarios` | `abrirModal()`, `actualizarSeccionHorarios()`, `onEditRolChange()` | `style.display` |
| `horarios-lista` | `abrirModal()`, `cargarHorarios()`, `renderHorarios()` | innerHTML dinámico |
| `error-horarios` | `mostrarAlerta()`, `guardarHorarios()` | toggle `.visible` + className |

### Modal de reseteo

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `modal-reset-fondo` | `resetearClave()`, `cerrarModalReset()`, `init()` | toggle clase `.abierto` |
| `reset-texto-confirmar` | `resetearClave()` | `.textContent` |
| `reset-paso-confirmar` | `resetearClave()`, `ejecutarReset()` | `style.display` |
| `btn-confirmar-reset` | `ejecutarReset()` | `.disabled` + `.textContent` |
| `reset-paso-resultado` | `ejecutarReset()` | `style.display` |
| `reset-clave-display` | `ejecutarReset()` | `.textContent` |

---

## 2. Clases CSS generadas dinámicamente por JS

### Por `inicializarChipsUsuarios()`
- `.area-chip` — chip base (createElement + className)
- `.area-chip.activo` — chip seleccionado (classList.add/remove/toggle)

### Por `mostrarAlerta()` y `mostrarAlertaModal()`
- `.alerta.visible` — muestra bloque error o ok (classList.add/remove)

### Por `renderUsuarios()` en `#tbody-usuarios`
- `.badge-activo` / `.badge-inactivo` — estado del usuario (hardcoded en template string)
- `.vacio` — sin resultados (en `<td colspan="7">`)
- `.cargando` — estado de carga inicial
- `btn btn-ghost btn-sm` — botón Editar (hardcoded en template string — **no renombrar**)

### Por `construirAreaCheckboxes()`
- `.area-check-item` — fila de checkbox de área
- `.area-check-item.checked` — área marcada (classList.toggle)
- `.atiende-turnos-group` — grupo oculto por defecto
- `.atiende-turnos-group.visible` — grupo visible (classList.toggle)

### Por `abrirModal()` / `cerrarModal()`
- `.modal-fondo.abierto` — abre el modal (classList.add/remove)
- Ídem `#modal-reset-fondo` vía `resetearClave()` / `cerrarModalReset()`

### Por `renderHorarios()` en `#horarios-lista`
- `.horarios-servicio` — bloque por servicio
- `.horarios-srv-nombre` — título del servicio
- `.horarios-grilla` — contenedor de filas
- `.horario-dia-fila` — fila de un día
- `.horario-dia-check` — label + checkbox del día
- `.horario-dia-label` — nombre del día
- `.horario-dia-horas` — inputs de hora (visibility toggle inline)
- `.horario-sep` — guión entre horas
- `.horario-hora-ini` / `.horario-hora-fin` — inputs time
- `.separador` — `<hr>` entre servicios

### Por `guardarHorarios()` — error display inline (L999–1000)
- Reasigna `errEl.className = 'alerta alerta-ok visible'` y luego restaura a `'alerta alerta-error'`
- Ambas clases deben existir en CSS

---

## 3. Funciones JS — categorización

### Lógica de negocio — NO MODIFICAR

| Función | Por qué |
|---|---|
| `getToken()`, `getUsuario()`, `apiFetch()`, `cerrarSesion()` | Auth |
| `esc(s)` | Sanitización HTML |
| `mostrarAlerta()`, `mostrarAlertaModal()` | Estado UI |
| `formatFecha(ts)` | Parseo de fecha |
| `inicializarChipsUsuarios()`, `aplicarFiltroAreaUsuarios()` | B9 filtro |
| `renderUsuarios(data)` | Render tabla — contiene lógica de permisos |
| `construirAreaCheckboxes()`, `leerAreasSeleccionadas()` | B2+B3 |
| `onNuevoRolChange()`, `onEditRolChange()` | Lógica de visibilidad por rol |
| `actualizarSeccionHorarios()` | B4 show/hide |
| `cargarUsuarios()`, `crearUsuario()` | CRUD |
| `abrirModal()`, `cerrarModal()`, `guardarEdicion()` | Modal edición |
| `resetearClave()`, `ejecutarReset()`, `cerrarModalReset()`, `resetearClaveDesdeModal()` | Reseteo |
| `cargarHorarios()`, `cargarServiciosParaHorarios()`, `renderHorarios()` | B4 |
| `onDiaCheck()`, `onHorarioDiaChange()`, `guardarHorarios()` | B4 CRUD |
| `init()` | Bootstrap (con adiciones de sidebar) |

### Presentación — SE PUEDE REESCRIBIR

| Función | Qué cambiar |
|---|---|
| `rolBadgeHTML(rol)` | Inline styles → `.role-badge .role-XXX` |
| `badgeRol(rol)` | Inline styles → `.role-badge .role-XXX` |

---

## 4. Mismatches críticos

### A. `rolBadgeHTML()` — usado en sidebar (nav-nombre)

```javascript
// ANTES:
function rolBadgeHTML(rol) {
  const cfg = {
    operador:  { bg: '#1e40af', label: 'Operador' },
    encargado: { bg: '#166534', label: 'Encargado' },
    sistemas:  { bg: '#6b21a8', label: 'Sistemas' },
    directivo: { bg: '#374151', label: 'Solo lectura' },
  };
  const { bg, label } = cfg[rol] || { bg: '#374151', label: rol };
  return `<span class="badge-rol" style="background:${bg};color:white">${label}</span>`;
}

// DESPUÉS:
function rolBadgeHTML(rol) {
  const cfg = {
    operador:  { cls: 'role-operador',  label: 'Operador'     },
    encargado: { cls: 'role-encargado', label: 'Encargado'    },
    sistemas:  { cls: 'role-sistemas',  label: 'Sistemas'     },
    directivo: { cls: 'role-directivo', label: 'Solo lectura' },
  };
  const { cls, label } = cfg[rol] || { cls: 'role-admin', label: rol };
  return `<span class="role-badge ${cls}">${label}</span>`;
}
```

### B. `badgeRol()` — usado en tabla de usuarios

```javascript
// ANTES:
function badgeRol(rol) {
  const cfg = {
    operador:  { bg: '#dbeafe', color: '#1e40af', label: 'Operador' },
    encargado: { bg: '#dcfce7', color: '#166534', label: 'Encargado' },
    sistemas:  { bg: '#f3e8ff', color: '#6b21a8', label: 'Sistemas' },
    directivo: { bg: '#f1f5f9', color: '#374151', label: 'Directivo' },
  };
  const { bg, color, label } = cfg[rol] || { bg: '#f1f5f9', color: '#374151', label: rol };
  return `<span class="badge" style="background:${bg};color:${color}">${esc(label)}</span>`;
}

// DESPUÉS:
function badgeRol(rol) {
  const cfg = {
    operador:  { cls: 'role-operador',  label: 'Operador'  },
    encargado: { cls: 'role-encargado', label: 'Encargado' },
    sistemas:  { cls: 'role-sistemas',  label: 'Sistemas'  },
    directivo: { cls: 'role-directivo', label: 'Directivo' },
  };
  const { cls, label } = cfg[rol] || { cls: 'role-admin', label: rol };
  return `<span class="role-badge ${cls}">${esc(label)}</span>`;
}
```

### C. Toggle activo/inactivo — NO SE IMPLEMENTA

El README §5 describe un toggle visual 32x18px. El JS actual usa `<select id="edit-activo">` con `.value === '1'/'0'`. Cambiar a un toggle requeriría modificar `guardarEdicion()`. Se mantiene el `<select>` y se estiliza con tokens. La tabla muestra `.badge-activo`/`.badge-inactivo` (no toggle).

### D. `.btn-ghost` en template string JS — mantener en CSS local

`renderUsuarios()` L494 genera:
```javascript
`<button class="btn btn-ghost btn-sm" onclick="abrirModal(${u.id})">Editar</button>`
```

No se puede cambiar sin tocar lógica. Consecuencia:
- `.btn-ghost` se **mantiene en CSS local** con estilos de tokens (idéntico a `.btn-secondary`)
- Los botones `.btn-ghost` del **HTML estático** (L165, L293) SÍ se renombran a `.btn-secondary`
- Resultado: `.btn-ghost` (JS-generated) y `.btn-secondary` (static HTML) coexisten con estilos iguales

### E. `.btn-success` — no renombrar (leído por JS)

`guardarHorarios()` L976 lee: `document.querySelector('#seccion-horarios .btn-success')`.
Se mantiene `.btn-success` en CSS local con `background: var(--teal)`.

---

## 5. Inline styles en HTML estático — a extraer a clases

| Línea | HTML actual | Solución |
|---|---|---|
| L201, L205, L209, L214 | `<span style="color:#dc2626">*</span>` (×4) | `<span class="req">*</span>` |
| L226 | `<span style="color:#dc2626">*</span>` en `nuevo-areas-titulo` | ídem |
| L228 | `<span style="color:#94a3b8;...">Cargando áreas...</span>` | `<span class="placeholder-text">` |
| L272 | ídem en modal | ídem |
| L278 | `style="margin-bottom:.6rem"` en `.form-seccion-titulo` | quitar: CSS absorbe |
| L280 | `<span class="cargando" style="padding:1rem">` | JS lo sobreescribe igual — excluir |
| L291 | `style="display:none;color:#dc2626;border-color:#fca5a5;margin-right:auto"` | keep `style="display:none"` (JS-controlled); mover colores a `#btn-resetear-en-modal` CSS |
| L301 | `<div class="modal-caja" style="max-width:440px">` | `<div class="modal-caja modal-caja-sm">` |
| L306 | `<p style="color:#475569;font-size:.875rem;margin-bottom:1rem" id="reset-texto-confirmar">` | `<p class="modal-text" id="reset-texto-confirmar">` |
| L307, L326 | `<div class="modal-footer" style="margin-top:0">` | `<div class="modal-footer modal-footer-flush">` |
| L315 | `<p style="color:#475569;font-size:.875rem;margin-bottom:.75rem">` | `<p class="modal-text">` |
| L318–322 | `<div id="reset-clave-display" style="...complejo...">` | regla CSS para `#reset-clave-display` |
| L323 | `<p style="color:#64748b;font-size:.8rem;margin-bottom:1rem">` | `<p class="form-hint">` |

### Style attributes que SE MANTIENEN (JS-controlled)
- `#seccion-horarios style="display:none"` — `actualizarSeccionHorarios()` / `onEditRolChange()` usan `style.display`
- `#reset-paso-resultado style="display:none"` — `ejecutarReset()` usa `style.display`
- `#btn-resetear-en-modal style="display:none"` — `abrirModal()` usa `style.display` (mantener solo el `display:none`)

---

## 6. Inline styles en `<script>` — exclusiones (6 líneas hex)

Estos inline styles están en template strings de funciones de lógica/render. No se modifican.

```javascript
// renderUsuarios() L487
<td style="color:#64748b">${esc(u.email)}</td>

// renderUsuarios() L489
<td style="color:#64748b;font-size:.8rem">${areas}</td>

// renderUsuarios() L491
<td style="color:#64748b">${formatFecha(u.ultimo_acceso)}</td>

// renderUsuarios() L495
'<span style="color:#94a3b8;font-size:.78rem">Sin permiso</span>'

// construirAreaCheckboxes() L511
'<span style="color:#94a3b8;font-size:.85rem">No hay áreas disponibles.</span>'

// cargarHorarios() L824
'<span style="color:#dc2626;font-size:.85rem">No se pudieron cargar los horarios.</span>'
```

**Hex count esperado en `<script>` después del rediseño: 6 líneas.**

Adicionalmente, hay style attributes sin hex que tampoco se tocan:
- `renderUsuarios()` L486: `style="font-weight:500"` — sin hex
- `abrirModal()` L689: `style="padding:1rem"` — sin hex

---

## 7. Mapeo de colores hardcodeados → tokens

### CSS en `<style>` interno

| Contexto | Valor actual | Token equivalente |
|---|---|---|
| Body bg `#f1f5f9` | — | cubierto por design-tokens.css (`--bg-2`) |
| Body color `#1e293b` | — | cubierto (`--text-1`) |
| `.navbar` + `.nav-*` + `.badge-rol` | eliminados | → sidebar |
| `h1 color: #1A3C4B; font-family: Trebuchet` | eliminado | → `.page-title` |
| `.card bg: white` | `white` | `var(--bg-3)` |
| `.card box-shadow: rgba(0,0,0,.08)` | — | `0 0 0 1px var(--border)` |
| `.card-titulo color: #1A3C4B` | `#1A3C4B` | `var(--text-1)` |
| `.card-titulo font-family: Trebuchet` | — | `var(--font-ui)` |
| `.btn-primary bg: #1A3C4B` | — | drop: usar `.btn-primary` de design-tokens.css |
| `.btn-ghost bg: white; color: #374151; border: #d1d5db` | — | keep local con tokens: `var(--bg-4)`, `var(--text-2)`, `var(--border)` |
| `.btn-danger bg: #dc2626` | `#dc2626` | `var(--red)` |
| `.btn-success bg: #16a34a` | `#16a34a` | `var(--teal)` (cambio visual intencional) |
| `.alerta-error bg: #fef2f2; border: #fecaca; color: #991b1b` | — | `var(--red-dim)`, `var(--red-mid)`, `var(--red)` |
| `.alerta-ok bg: #f0fdf4; border: #bbf7d0; color: #166534` | — | `var(--teal-dim)`, `var(--teal-mid)`, `var(--teal)` |
| `th bg: #f8fafc; color: #64748b; border: #e2e8f0` | — | `var(--bg-1)`, `var(--text-3)`, `var(--border)` |
| `td border: #f1f5f9` | `#f1f5f9` | `var(--border)` |
| `tr:hover bg: #fafafa` | `#fafafa` | `var(--bg-4)` |
| `.badge-activo bg: #dcfce7; color: #166534` | — | `var(--teal-dim)`, `var(--teal)` |
| `.badge-inactivo bg: #fee2e2; color: #b91c1c` | — | `var(--red-dim)`, `var(--red)` |
| `.form-grupo label color: #374151` | `#374151` | `var(--text-2)` |
| `input, select border: #d1d5db; bg: white` | — | `var(--border)`, `var(--bg-4)` |
| `input:focus, select:focus border: #1A3C4B` | `#1A3C4B` | `var(--border-hi)` |
| `.form-hint color: #64748b` | `#64748b` | `var(--text-3)` |
| `.form-seccion-titulo color: #64748b` | `#64748b` | `var(--text-3)` |
| `.area-check-item border: #e2e8f0` | `#e2e8f0` | `var(--border)` |
| `.area-check-item:hover bg: #f8fafc` | `#f8fafc` | `var(--bg-4)` |
| `.area-check-item.checked bg: #f0f9ff; border: #bae6fd` | — | `var(--blue-dim)`, `var(--blue-mid)` |
| `.area-check-item accent-color: #1A3C4B` | `#1A3C4B` | `var(--teal)` |
| `.area-check-nombre color: #1e293b` | `#1e293b` | `var(--text-1)` |
| `.atiende-turnos-group color: #64748b` | `#64748b` | `var(--text-2)` |
| `.atiende-turnos-group accent: #16a34a` | `#16a34a` | `var(--teal)` |
| `.modal-fondo bg: rgba(0,0,0,.45)` | — | mantener (overlay estándar) |
| `.modal-caja bg: white; radius: 10px` | `white` | `var(--bg-3)`, `var(--radius-lg)` |
| `.modal-caja box-shadow: rgba(0,0,0,.25)` | — | `0 20px 60px rgba(0,0,0,.55)` |
| `.modal-caja h3 color: #1e293b; font-family: Trebuchet` | — | `var(--text-1)`, `var(--font-ui)` |
| `.modal-seccion border: #f1f5f9` | `#f1f5f9` | `var(--border)` |
| `.modal-footer border: #f1f5f9` | `#f1f5f9` | `var(--border)` |
| `.horarios-srv-nombre color: #475569` | `#475569` | `var(--text-2)` |
| `.horario-dia-label color: #374151` | `#374151` | `var(--text-2)` |
| `.horario-sep color: #94a3b8` | `#94a3b8` | `var(--text-3)` |
| `.horario-hora-* border: #d1d5db; bg: white` | — | `var(--border)`, `var(--bg-4)` |
| `.horario-hora-*:focus border: #1A3C4B` | `#1A3C4B` | `var(--border-hi)` |
| `.horarios-empty color: #94a3b8` | `#94a3b8` | `var(--text-3)` |
| `.area-selector-titulo color: #64748b` | `#64748b` | `var(--text-3)` |
| `.area-chip border: #e2e8f0; color: #475569; bg: white` | — | `var(--border)`, `var(--text-2)`, `transparent` |
| `.area-chip:hover border/color: #1A3C4B` | `#1A3C4B` | `var(--border-hi)`, `var(--text-1)` |
| `.area-chip.activo border/bg: #1A3C4B; color: white` | `#1A3C4B` | `var(--teal-mid)`, `var(--teal-dim)`, `var(--teal)` |
| `.cargando color: #94a3b8` | `#94a3b8` | `var(--text-3)` |
| `.vacio color: #94a3b8` | `#94a3b8` | `var(--text-3)` |
| `.separador border: #f1f5f9` | `#f1f5f9` | `var(--border)` |

### Inline en HTML estático (nuevas clases)

| Clase nueva | Tokens usados |
|---|---|
| `.req` (asterisco campo requerido) | `color: var(--red)` |
| `.placeholder-text` (cargando áreas) | `color: var(--text-3)`, `font-style: italic` |
| `.modal-text` (párrafos de modales) | `color: var(--text-2)`, `font-size: var(--text-base)` |
| `.modal-footer-flush` | `margin-top: 0; border-top: none; padding-top: 0` |
| `.modal-caja-sm` | `max-width: 440px` |
| `#reset-clave-display` | `background: var(--teal-dim); border: 2px solid var(--teal-mid); color: var(--teal)` |
| `#btn-resetear-en-modal` (CSS) | `color: var(--red); border-color: var(--red-mid); margin-right: auto` |

---

## 8. Nueva estructura HTML objetivo

```
<head>
  <link rel="stylesheet" href="/assets/design-tokens.css">
  <style> … solo lo local … </style>
</head>
<body>

  <div class="app-shell">

    <aside class="sidebar">
      sidebar-header (logo MVLA)
      sidebar-user-card (id="sidebar-avatar")
      sidebar-nav:
        · label "Calendario"
          · Agenda      → /panel/agenda.html
          · Presencial  → /panel/presencial.html
          · Bloqueos    → /panel/bloqueos.html
        · label "Reportes" (id="label-reportes", style="display:none")
          · Auditoría   (id="nav-auditoria", style="display:none")
          · Dashboard   (id="nav-dashboard", style="display:none")
        · label "Admin." (id="label-admin", style="display:none")
          · Usuarios   ← nav-item.active (sin ID — siempre visible aquí)
          · Servicios  (id="nav-servicios", style="display:none")
      sidebar-footer (id="nav-nombre" + btn-logout-sidebar)
    </aside>

    <main class="main-content">
      <div class="page-inner">

        <div class="page-header">
          <p class="page-supertitle">Panel de gestión</p>
          <h1 class="page-title">Gestión de usuarios</h1>
        </div>

        <!-- Card: lista de usuarios -->
        <div class="card">
          <div class="card-titulo">
            <span>Usuarios del panel</span>
            <button class="btn btn-secondary btn-sm" onclick="cargarUsuarios()">↻ Actualizar</button>
          </div>
          <!-- B9 -->
          <div class="area-selector" id="selector-areas-usu"> … </div>
          <!-- alertas -->
          <div class="alerta alerta-error" id="error-lista"></div>
          <div class="alerta alerta-ok"    id="ok-lista"></div>
          <!-- tabla -->
          <div class="tabla-wrapper"> … <tbody id="tbody-usuarios"> … </div>
        </div>

        <!-- Card: nuevo usuario -->
        <div class="card" id="card-nuevo-usuario">
          <div class="card-titulo">Nuevo usuario</div>
          <div class="alerta alerta-error" id="error-form"></div>
          <div class="form-grid">
            <!-- campos con <span class="req">*</span> -->
            <!-- #nuevo-areas-lista con <span class="placeholder-text"> -->
          </div>
          <div class="form-pie">
            <button class="btn btn-primary" onclick="crearUsuario()">Crear usuario</button>
          </div>
        </div>

      </div><!-- .page-inner -->
    </main>

  </div><!-- .app-shell -->

  <!-- Modal edición — sin cambios estructurales excepto: -->
  <!-- btn-ghost → btn-secondary en Cancelar -->
  <!-- placeholder-text en áreas-lista -->
  <!-- modal-footer-flush en los modal-footer internos -->
  <!-- btn-resetear-en-modal: quitar inline styles de color -->

  <!-- Modal reseteo — cambios: -->
  <!-- modal-caja-sm class -->
  <!-- modal-text en párrafos -->
  <!-- modal-footer-flush en footers internos -->
  <!-- #reset-clave-display: quitar inline styles -->

  <script> … </script>
</body>
```

---

## 9. CSS nuevo para el `<style>` interno

```css
/* ══════════════════════════════════════════════════════════════
   usuarios.html — estilos locales (design system C+)
   Todos los colores vienen de design-tokens.css.
══════════════════════════════════════════════════════════════ */

/* ── Layout shell ────────────────────────────────────────────── */
.app-shell    { display: flex; height: 100vh; overflow: hidden; }
.main-content { flex: 1; overflow-y: auto; background: var(--bg-2); }
.page-inner   { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }

/* ── Header de página ────────────────────────────────────────── */
.page-supertitle {
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--teal);
  margin-bottom: 0.2rem;
}
.page-title {
  font-size: var(--text-xl);
  font-weight: 800;
  color: var(--text-1);
  margin-bottom: 1.5rem;
}

/* ── Sidebar (idéntico a dashboard/auditoria) ────────────────── */
.sidebar { width: var(--sidebar-width); background: var(--bg-1); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; overflow-y: auto; }
.sidebar-header { display: flex; align-items: center; gap: var(--gap-sm); padding: 14px 12px 10px; border-bottom: 1px solid var(--border); }
.sidebar-logo { width: 36px; height: 36px; border-radius: var(--radius-xl); background: var(--teal-dim); color: var(--teal); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; flex-shrink: 0; letter-spacing: 0.04em; }
.sidebar-muni { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); }
.sidebar-ciudad { font-size: 12.5px; font-weight: 700; color: var(--text-1); }
.sidebar-user-card { margin: 8px; padding: 7px 9px; border-radius: var(--radius-md); display: flex; align-items: center; gap: var(--gap-sm); }
.sidebar-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: var(--text-xs); font-weight: 700; flex-shrink: 0; }
.nav-section-label { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); padding: 10px 12px 4px; }
.sidebar-nav { padding: 0 6px; flex: 1; }
.sidebar-footer { border-top: 1px solid var(--border); padding: 10px 12px; }
.btn-logout-sidebar { background: transparent; border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-2); padding: 5px 10px; font-family: var(--font-ui); font-size: var(--text-sm); cursor: pointer; width: 100%; transition: var(--transition-fast); }
.btn-logout-sidebar:hover { background: var(--bg-4); border-color: var(--border-hi); color: var(--text-1); }

/* ── Card ────────────────────────────────────────────────────── */
.card {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}
.card-titulo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  font-family: var(--font-ui);
  font-weight: 700;
  color: var(--text-1);
  font-size: var(--text-base);
}

/* ── Botones locales (lo que design-tokens.css no incluye) ───── */
/* .btn, .btn-primary, .btn-secondary → vienen de design-tokens.css */
.btn-ghost   { background: var(--bg-4); color: var(--text-2); border: 1px solid var(--border); }
.btn-ghost:hover:not(:disabled) { border-color: var(--border-hi); color: var(--text-1); }
.btn-danger  { background: var(--red);  color: var(--bg-0); border: none; }
.btn-success { background: var(--teal); color: var(--bg-0); border: none; }
.btn-sm      { padding: 0.25rem 0.6rem; font-size: var(--text-sm); }
.btn-xs      { padding: 0.18rem 0.45rem; font-size: var(--text-xs); }

/* ── Alertas ─────────────────────────────────────────────────── */
.alerta { padding: 0.7rem 1rem; border-radius: var(--radius-md); font-size: var(--text-base); margin-bottom: 1rem; display: none; }
.alerta.visible { display: block; }
.alerta-error { background: var(--red-dim);  border: 1px solid var(--red-mid);  color: var(--red);  }
.alerta-ok    { background: var(--teal-dim); border: 1px solid var(--teal-mid); color: var(--teal); }

/* ── Tabla ───────────────────────────────────────────────────── */
.tabla-wrapper { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th {
  background: var(--bg-1);
  color: var(--text-3);
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.7rem 1rem;
  border-bottom: 2px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
td { padding: 0.8rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; font-size: var(--text-base); color: var(--text-1); }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--bg-4); }
.td-acciones { display: flex; gap: 0.35rem; }

/* ── Badges de estado y rol ──────────────────────────────────── */
/* .role-badge y .role-* vienen de design-tokens.css */
.badge         { display: inline-block; padding: 0.18rem 0.55rem; border-radius: 99px; font-size: var(--text-xs); font-weight: 600; }
.badge-activo  { background: var(--teal-dim); color: var(--teal); }
.badge-inactivo{ background: var(--red-dim);  color: var(--red);  }

/* ── Utilidades de formulario ────────────────────────────────── */
.req { color: var(--red); }
.placeholder-text { color: var(--text-3); font-size: var(--text-sm); font-style: italic; }

/* ── Formulario ──────────────────────────────────────────────── */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
.form-grupo { display: flex; flex-direction: column; gap: 0.3rem; }
.form-grupo.full { grid-column: 1 / -1; }
.form-grupo label { font-size: var(--text-sm); font-weight: 500; color: var(--text-2); }
.form-grupo input, .form-grupo select {
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-family: var(--font-ui);
  background: var(--bg-4);
  color: var(--text-1);
}
.form-grupo input:focus, .form-grupo select:focus { outline: none; border-color: var(--border-hi); box-shadow: 0 0 0 2px var(--teal-dim); }
.form-pie { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.form-hint { font-size: var(--text-xs); color: var(--text-3); margin-top: 0.25rem; }
.form-seccion-titulo { font-size: var(--text-xs); font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.4rem; }

/* ── B2+B3: Checkboxes de área ───────────────────────────────── */
.area-check-lista { display: flex; flex-direction: column; gap: 0.35rem; }
.area-check-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-fast);
  user-select: none;
}
.area-check-item:hover { background: var(--bg-4); }
.area-check-item.checked { background: var(--blue-dim); border-color: var(--blue-mid); }
.area-check-item input[type="checkbox"] { cursor: pointer; accent-color: var(--teal); flex-shrink: 0; }
.area-check-nombre { flex: 1; font-size: var(--text-base); color: var(--text-1); }
.atiende-turnos-group {
  display: none;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--text-xs);
  color: var(--text-2);
  white-space: nowrap;
}
.atiende-turnos-group.visible { display: flex; }
.atiende-turnos-group input[type="checkbox"] { accent-color: var(--teal); }

/* ── Modal ───────────────────────────────────────────────────── */
.modal-fondo { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; align-items: center; justify-content: center; padding: 1rem; overflow-y: auto; }
.modal-fondo.abierto { display: flex; }
.modal-caja { background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; max-width: 600px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.55); max-height: 90vh; overflow-y: auto; }
.modal-caja-sm { max-width: 440px; }
.modal-caja h3 { font-family: var(--font-ui); font-size: var(--text-xl); color: var(--text-1); margin-bottom: 1rem; font-weight: 800; }
.modal-seccion { border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 1rem; }
.modal-footer { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 1rem; }
.modal-footer-flush { margin-top: 0; border-top: none; padding-top: 0; }
.modal-text { color: var(--text-2); font-size: var(--text-base); margin-bottom: 1rem; }

/* ── B4: Horarios semanal ────────────────────────────────────── */
.horarios-lista { display: flex; flex-direction: column; gap: 1rem; }
.horarios-srv-nombre { font-size: var(--text-xs); font-weight: 700; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; }
.horarios-grilla { display: flex; flex-direction: column; gap: 0.3rem; }
.horario-dia-fila { display: flex; align-items: center; gap: 0.75rem; padding: 0.25rem 0; }
.horario-dia-check { display: flex; align-items: center; gap: 0.4rem; min-width: 115px; cursor: pointer; }
.horario-dia-check input[type="checkbox"] { accent-color: var(--teal); cursor: pointer; }
.horario-dia-label { font-size: var(--text-sm); color: var(--text-2); user-select: none; }
.horario-dia-horas { display: flex; align-items: center; gap: 0.35rem; }
.horario-sep { font-size: var(--text-sm); color: var(--text-3); }
.horario-hora-ini, .horario-hora-fin {
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-family: var(--font-ui);
  background: var(--bg-4);
  color: var(--text-1);
}
.horario-hora-ini:focus, .horario-hora-fin:focus { outline: none; border-color: var(--border-hi); }
.horarios-empty { font-size: var(--text-sm); color: var(--text-3); font-style: italic; }
.horarios-footer { display: flex; gap: 0.5rem; margin-top: 1rem; }

/* ── Reset de clave — display de clave generada ──────────────── */
#reset-clave-display {
  background: var(--teal-dim);
  border: 2px solid var(--teal-mid);
  border-radius: var(--radius-lg);
  padding: 0.75rem 1rem;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: var(--teal);
  text-align: center;
  margin-bottom: 1rem;
  font-family: var(--font-mono);
}

/* ── Botón resetear en modal — color específico ──────────────── */
#btn-resetear-en-modal {
  color: var(--red);
  border-color: var(--red-mid);
  margin-right: auto;
}

/* ── B9: Selector de área ────────────────────────────────────── */
.area-selector { margin-bottom: 0.75rem; display: none; }
.area-selector.visible { display: block; }
.area-selector-titulo { font-size: var(--text-xs); font-weight: 600; color: var(--text-3); margin-bottom: 0.4rem; text-transform: uppercase; letter-spacing: 0.04em; }
.area-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.area-chip { display: inline-flex; align-items: center; padding: 0.3rem 0.7rem; border: 1px solid var(--border); border-radius: 99px; cursor: pointer; font-size: var(--text-sm); font-weight: 500; color: var(--text-2); background: transparent; transition: var(--transition-fast); user-select: none; }
.area-chip:hover  { border-color: var(--border-hi); color: var(--text-1); }
.area-chip.activo { border-color: var(--teal-mid); background: var(--teal-dim); color: var(--teal); font-weight: 600; }

/* ── Misc ────────────────────────────────────────────────────── */
.cargando  { text-align: center; color: var(--text-3); padding: 3rem; font-style: italic; }
.vacio     { text-align: center; color: var(--text-3); padding: 3rem; }
.separador { border: none; border-top: 1px solid var(--border); margin: 0.75rem 0; }
```

---

## 10. Cambios en el bloque `<script>`

### `rolBadgeHTML()` — ver §4.A

### `badgeRol()` — ver §4.B

### `init()` — agregar bloque sidebar-avatar + labels (después de `nombreEl.innerHTML = ...`)

```javascript
// Sidebar avatar: iniciales + color según rol
const avatarEl = document.getElementById('sidebar-avatar');
if (avatarEl) {
  const partes    = (usuario.nombre || '').trim().split(/\s+/);
  const iniciales = partes.slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';
  const avatarCfg = {
    encargado: { bg: 'var(--teal-mid)',  color: 'var(--teal)'  },
    operador:  { bg: 'var(--blue-mid)',  color: 'var(--blue)'  },
    sistemas:  { bg: 'var(--amber-mid)', color: 'var(--amber)' },
    directivo: { bg: 'var(--amber-mid)', color: 'var(--amber)' },
  };
  const ac = avatarCfg[usuario.rol] || avatarCfg.operador;
  avatarEl.textContent      = iniciales;
  avatarEl.style.background = ac.bg;
  avatarEl.style.color      = ac.color;
}

// Labels de sección del sidebar
const lRep = document.getElementById('label-reportes');
if (lRep) lRep.style.display = '';
const lAdm = document.getElementById('label-admin');
if (lAdm) lAdm.style.display = '';
```

> El forEach existente que muestra `nav-auditoria`, `nav-dashboard`, `nav-servicios` se mantiene sin cambios.

---

## 11. Verificaciones de cierre (Paso 2 y 3)

### Paso 2 — Clases generadas por JS

- ¿`.area-chip` y `.area-chip.activo` en CSS?
- ¿`.alerta.visible` con `display: block`?
- ¿`.badge-activo` y `.badge-inactivo` con tokens?
- ¿`.area-check-item`, `.area-check-item.checked`?
- ¿`.atiende-turnos-group` oculto y `.atiende-turnos-group.visible`?
- ¿`.modal-fondo.abierto { display: flex }`?
- ¿`.cargando` y `.vacio` presentes?
- ¿`.badge` (base) presente para `.badge-activo`/`.badge-inactivo`?
- ¿`guardarHorarios()` puede asignar `.alerta-ok visible` y revertir a `.alerta-error`?

### Paso 3 — Certificación

- grep: 0 hex en `<style>`
- grep: 0 hex en HTML estático
- `.navbar`, `.nav-links`, `.nav-user`, `.btn-logout[^-]`, `.badge-rol`, `.btn-ghost` en `<style>` → 0 (`.btn-ghost` solo existe como clase en HTML/JS, no como selector en `<style>` con hex)
- `rolBadgeHTML()` y `badgeRol()` sin hex ni `style=`
- Hex count en `<script>` = 6 líneas (exclusiones §6)
- 0 ocurrencias de `btn-ghost` en HTML estático (renombradas a `btn-secondary`)
- `btn-ghost` sigue existiendo solo en template string L494 (dentro de script — correcto)

---

## 12. Orden de implementación

### Paso 1 — Layout shell, sidebar, CSS completo + ajustes de JS

- Agregar `<link rel="stylesheet" href="/assets/design-tokens.css">` en el `<head>`
- Reemplazar `<nav class="navbar">` y todo su CSS por el sidebar de dashboard.html
- Cambiar `.nav-item.active` al ítem "Usuarios"
- Agregar `id="sidebar-avatar"`, `id="label-reportes"` (display:none), `id="label-admin"` (display:none)
- `nav-auditoria` (display:none), `nav-dashboard` (display:none), `nav-servicios` (display:none)
- Wrap del contenido en `.app-shell > .main-content > .page-inner`
- HTML: `.page-header` con "Panel de gestión" / "Gestión de usuarios"
- HTML: renombrar `.btn-ghost` → `.btn-secondary` en los 2 botones estáticos (Actualizar L165, Cancelar modal L293)
- HTML: extraer todos los inline styles del §5 a clases
- CSS: incluir **todo el CSS del §9** en este paso
- **JS `rolBadgeHTML()`:** reescribir (§4.A)
- **JS `badgeRol()`:** reescribir (§4.B)
- **JS `init()`:** agregar bloque `sidebar-avatar` + `lRep`/`lAdm` (§10)

### Paso 2 — Verificación de clases generadas por JS ✅ COMPLETADO

9/9 checks PASS (2026-06-26):
- `.area-chip` / `.area-chip.activo` → L224–226 ✅
- `.alerta.visible { display: block }` → L80 ✅
- `.badge-activo` / `.badge-inactivo` con tokens → L108–109 ✅
- `.area-check-item` / `.area-check-item.checked` → L137, L149 ✅
- `.atiende-turnos-group` display:none base + `.visible { display:flex }` → L152, L160 ✅
- `.modal-fondo.abierto { display: flex }` → L165 ✅
- `.cargando` / `.vacio` → L229–230 ✅
- `.badge` (base) → L107 ✅
- `guardarHorarios()` asigna `alerta-ok visible` y revierte a `alerta-error` → L1125–1126 ✅

### Paso 3 — Certificación final ✅ COMPLETADO

5/5 checks PASS (2026-06-26):
- 0 hex en `<style>` y HTML estático ✅ (6 hex en `<script>` — exclusiones §6)
- CSS viejo eliminado: `.navbar`, `.nav-links`, `.nav-user`, `.btn-logout`, `.badge-rol` → 0 ✅
- Hex count en `<script>` = 6 ✅
- `rolBadgeHTML()` y `badgeRol()` sin hex ni `style=` ✅
- `btn-ghost` en HTML estático = 0 ✅ (fix: `#btn-resetear-en-modal` → `btn-secondary`)

### Commits
- `291cf3c` — docs(plan): usuarios — plan de rediseño design system C+
- `1287da8` — feat(panel): usuarios — rediseño design system C+
- `4ffa04b` — docs(plan): usuarios paso 2 — verificación clases JS, 9/9 PASS
- `[paso 3]` — docs(plan): usuarios paso 3 — certificación final, 5 checks PASS + fix btn-ghost
