# Plan de rediseño — bloqueos.html
# Referencia: design_handoff_sistema_turnos/README.md § tokens globales
# Restricciones: Vanilla JS · no tocar lógica JS · solo vars de design-tokens.css

---

## 1. Inventario de IDs obligatorios

Estos IDs son leídos o escritos por el JS y deben sobrevivir intactos.

### Sidebar — inicialización por `init()`
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `nav-nombre` | `init()` | inyecta `nombre + rolBadgeHTML()` |
| `sidebar-avatar` | `init()` | iniciales del usuario + fondo/color según rol (**no existe en el init() actual — hay que agregarlo**, igual que en presencial.html) |
| `nav-auditoria` | `init()` | muestra/oculta según rol (`style.display`) |
| `nav-dashboard` | `init()` | muestra/oculta según rol |
| `nav-usuarios` | `init()` | muestra/oculta según rol |
| `nav-servicios` | `init()` | muestra/oculta según rol |
| `label-reportes` | `init()` | muestra label de sección según rol (**no existe en el init() actual — hay que agregarlo**, igual que en presencial.html) |
| `label-admin` | `init()` | muestra label de sección según rol (**no existe en el init() actual — hay que agregarlo**) |

> **Nota:** El `init()` actual de bloqueos.html no puebla `sidebar-avatar` ni muestra
> `label-reportes`/`label-admin`. Deben agregarse tanto al HTML del sidebar como a la
> lógica de `init()`, copiando exactamente el código de presencial.html.

### Card lista — chips de área (B9)
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `selector-areas-lista` | `inicializarChipsLista()` | agrega `.visible` para mostrar el bloque |
| `chips-areas-lista` | `inicializarChipsLista()`, `cargarBloqueos()` | inserta `<span class="area-chip">` dinámicamente; lee `.area-chip.activo` para armar la URL |

### Card lista — alertas y tabla
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `error-lista` | `mostrarAlertaLista()` | `.textContent` + toggle `.visible` |
| `ok-lista` | `mostrarAlertaLista()` | `.textContent` + toggle `.visible` |
| `tabla-bloqueos` | `cargarBloqueos()` | `.innerHTML` — inyecta tabla completa o mensajes |

### Card formulario — alertas
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `error-form` | `mostrarAlertaForm()` | `.textContent` + toggle `.visible` |
| `ok-form` | `mostrarAlertaForm()` | `.textContent` + toggle `.visible` |

### Card formulario — tipo de bloqueo
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `tipo-individual` | `crearBloqueo()`, `init()`, `onTipoChange()` | radio button; `.checked` leído y seteado |
| `tipo-oficina` | — (solo input) | radio button |
| `opcion-oficina` | `init()` | `style.display = 'none'` para ocultar a operadores |
| `hint-tipo` | `init()` | `.textContent` reemplazado según rol |

### Card formulario — área y operador (B5)
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `grupo-area` | `init()`, `crearBloqueo()` | `style.display = 'block/none'`; `.style.display` leído para decidir area_id |
| `sel-area` | `init()`, `onAreaFormChange()`, `crearBloqueo()` | `.value`, `.innerHTML` (se le agregan `<option>`) |
| `grupo-operador` | `onTipoChange()` | `style.display = 'block/none'` |
| `sel-operador` | `cargarOperadoresPorArea()`, `crearBloqueo()`, `init()` | `.value`, `.disabled`, `.innerHTML` |

### Card formulario — fechas, horas, motivo
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `fecha-inicio` | `crearBloqueo()`, `init()` | `.value`, `.min` |
| `fecha-fin` | `crearBloqueo()`, `init()` | `.value`, `.min` |
| `dia-completo` | `crearBloqueo()`, `onDiaCompletoChange()` | `.checked` |
| `grupo-horas` | `onDiaCompletoChange()` | `style.display = 'none/grid'` (debe ser `display:grid` cuando está visible) |
| `hora-inicio` | `crearBloqueo()`, `onDiaCompletoChange()` | `.value` |
| `hora-fin` | `crearBloqueo()`, `onDiaCompletoChange()` | `.value` |
| `motivo` | `crearBloqueo()` | `.value` |
| `btn-crear` | `crearBloqueo()`, `init()` | `.disabled`, `.textContent`, `style.display = 'none'` (directivo) |

---

## 2. Clases CSS generadas dinámicamente por JS

Estas clases son inyectadas vía `.innerHTML` o `.className` — deben existir en el CSS nuevo.

### Por `inicializarChipsLista()`:
- `.area-chip` — chip de área (base)
- `.area-chip.activo` — chip seleccionado

### Por `cargarBloqueos()` en `#tabla-bloqueos`:
- `.cargando` — texto italic "Cargando..." mientras espera la respuesta
- `.vacio` — texto centrado cuando no hay bloqueos vigentes
- `.badge` — clase base de todos los badges de tipo
- `.badge-individual` — badge "Individual" (generado como `badge badge-individual`)
- `.badge-oficina` — badge "Oficina" (generado como `badge badge-oficina`)
- `.badge-dia-completo` — badge "Día completo" (generado como `badge badge-dia-completo`)
- `.btn` + `.btn-danger` — botón "Eliminar" en cada fila (usa estas dos clases)

### Por `mostrarAlertaLista()` / `mostrarAlertaForm()`:
- `.alerta.visible` — toggle de `display: block` sobre `.alerta`

### Por `rolBadgeHTML()` (función de presentación):
- `.badge-rol` + estilos inline hardcodeados → a reemplazar por `.role-badge .role-XXX`
  (ver § 8 — cambios en `<script>`)

---

## 3. Funciones JS: presentación vs. lógica

### Lógica de negocio — NO MODIFICAR
| Función | Por qué no se toca |
|---|---|
| `getToken()`, `getUsuario()`, `apiFetch()`, `cerrarSesion()` | Auth |
| `mostrarAlertaLista()`, `mostrarAlertaForm()` | lógica de estado |
| `formatPeriodo()` | formato de fecha |
| `inicializarChipsLista()` | construcción de chips con handlers de filtrado |
| `cargarBloqueos()` | fetch + construcción de tabla |
| `eliminarBloqueo()` | fetch DELETE + confirm |
| `onTipoChange()` | lógica de visibilidad condicional |
| `onDiaCompletoChange()` | lógica de visibilidad + reset de inputs |
| `onAreaFormChange()` | trigger de recarga de operadores |
| `cargarOperadoresPorArea()` | fetch + poblar select |
| `crearBloqueo()` | fetch POST + validaciones |
| `init()` | inicialización async, fetch de áreas y operadores |

### Presentación — SE PUEDE REESCRIBIR (solo el HTML que genera)
| Función | Qué se puede cambiar |
|---|---|
| `rolBadgeHTML()` | Reemplaza estilos inline hardcodeados por `.role-badge .role-XXX`. La firma y el return de HTML no cambian. |

### Inline styles dentro de `cargarBloqueos()` — DEJAR INTACTOS
```javascript
// Dentro del template string de `filas`:
'<em style="color:#64748b">Toda el área</em>'          // inline en JS → no tocar
'<span style="color:#94a3b8;font-size:.8rem">—</span>' // inline en JS → no tocar
```
Estos hexadecimales están dentro del bloque `<script>`, embebidos en la lógica de
generación de filas. Se excluyen explícitamente del rediseño.

---

## 4. Mapeo de colores hardcodeados → tokens

### CSS en `<style>` interno

| Contexto | Valor actual | Token equivalente |
|---|---|---|
| Body bg | `#f1f5f9` | `var(--bg-0)` (ya en design-tokens.css) |
| Body color | `#1e293b` | `var(--text-1)` (ya en design-tokens.css) |
| `.navbar { background: #1A3C4B }` | eliminado | → reemplazado por sidebar |
| `.card { background: white }` | `white` | `var(--bg-3)` |
| `.card` box-shadow | `rgba(0,0,0,.08)` | `0 0 0 1px var(--border)` |
| `.card-titulo { color: #1A3C4B }` | `#1A3C4B` | `var(--text-1)` |
| `.card-titulo` font | `'Trebuchet MS'` | `var(--font-ui)` |
| `th { background: #f8fafc }` | `#f8fafc` | `var(--bg-2)` |
| `th { color: #64748b }` | `#64748b` | `var(--text-3)` |
| `th { border-bottom: 2px solid #e2e8f0 }` | `#e2e8f0` | `var(--border)` |
| `td { border-bottom: 1px solid #f1f5f9 }` | `#f1f5f9` | `var(--border)` |
| `tr:hover td { background: #fafafa }` | `#fafafa` | `var(--bg-4)` |
| `.vacio { color: #94a3b8 }` | `#94a3b8` | `var(--text-3)` |
| `.badge-individual { background: #ede9fe; color: #5b21b6 }` | purpura | `var(--blue-dim)` / `var(--blue)` / border `var(--blue-mid)` |
| `.badge-oficina { background: #fef3c7; color: #92400e }` | amber | `var(--amber-dim)` / `var(--amber)` / border `var(--amber-mid)` |
| `.badge-dia-completo { background: #f3f4f6; color: #374151 }` | gris neutro | `var(--bg-4)` / `var(--text-3)` / border `var(--border)` |
| `.alerta-error { background: #fef2f2; border: #fecaca; color: #991b1b }` | rojo | `var(--red-dim)` / `var(--red-mid)` / `var(--red)` |
| `.alerta-ok { background: #f0fdf4; border: #bbf7d0; color: #166534 }` | verde | `var(--teal-dim)` / `var(--teal-mid)` / `var(--teal)` |
| `label { color: #374151 }` | `#374151` | `var(--text-2)` |
| `label .opcional { color: #9ca3af }` | `#9ca3af` | `var(--text-3)` |
| `input, select, textarea { border: 1px solid #d1d5db }` | `#d1d5db` | `var(--border)` |
| `input, select, textarea { background: white }` | `white` | `var(--bg-4)` |
| `input:focus { border-color: #1A3C4B }` | `#1A3C4B` | `var(--border-hi)` |
| `input:focus box-shadow { rgba(26,60,75,.12) }` | custom | `var(--teal-dim)` |
| `.hint { color: #94a3b8 }` | `#94a3b8` | `var(--text-3)` |
| `.separador { border-top: 1px solid #f1f5f9 }` | `#f1f5f9` | `var(--border)` |
| `.btn-primary { background: #1A3C4B; color: white }` | eliminado | usar `.btn.btn-primary` de tokens |
| `.btn-danger { background: #dc2626; color: white }` | eliminado | usar `.btn.btn-danger` de tokens |
| `.btn-ghost { background: white; border: #d1d5db }` | eliminado | usar `.btn.btn-secondary` de tokens |
| `.cargando { color: #94a3b8 }` | `#94a3b8` | `var(--text-3)` |
| `.area-chip { border: 2px solid #e2e8f0; color: #475569 }` | claros | `var(--border)` / `var(--text-2)` |
| `.area-chip:hover { border-color: #1A3C4B; color: #1A3C4B }` | `#1A3C4B` | `var(--border-hi)` / `var(--text-1)` |
| `.area-chip.activo { border/bg: #1A3C4B; color: white }` | `#1A3C4B` | `var(--teal-mid)` / `var(--teal-dim)` / `var(--teal)` |
| `.area-selector-titulo { color: #64748b }` | `#64748b` | `var(--text-3)` |
| `.tipo-opcion label { border: 2px solid #e2e8f0; color: #475569 }` | claros | `var(--border)` / `var(--text-2)` |
| `.tipo-opcion :checked + label { border/bg: #1A3C4B }` | `#1A3C4B` | `var(--teal-mid)` / `var(--teal-dim)` / `var(--teal)` |
| `input:checked { accent-color: #1A3C4B }` (checkbox) | `#1A3C4B` | `var(--teal)` |

### En `rolBadgeHTML()` (bloque `<script>`)
| Rol | bg hardcoded | Solución |
|---|---|---|
| operador | `#1e40af` (blue) | `.role-badge .role-operador` |
| encargado | `#166534` (green) | `.role-badge .role-encargado` |
| sistemas | `#6b21a8` (purple) | `.role-badge .role-sistemas` |
| directivo | `#374151` (gray) | `.role-badge .role-directivo` |

---

## 5. Qué cubre design-tokens.css (no hay que redefinir)

| Uso | Clase de tokens |
|---|---|
| Botón primario (crear bloqueo) | `.btn.btn-primary` |
| Botón secundario (actualizar) | `.btn.btn-secondary` |
| Botón de eliminar en tabla | `.btn.btn-danger` — tokens usa rojo semitransparente (coherente con dark mode) |
| Badge de rol en navbar | `.role-badge .role-encargado/.role-operador/.role-sistemas/.role-directivo` |
| Chips de área | JS usa `.area-chip` → definir localmente con los mismos valores que `.filter-chip` de tokens |
| Reset global, font, bg/color del body | ya en `html, body { ... }` de design-tokens.css |

---

## 6. Nueva estructura HTML objetivo

```
<body>  ← design-tokens.css pone bg-0, font-ui, text-1

  <div class="app-shell">          ← flex, height:100vh

    <aside class="sidebar">        ← copiado íntegro de presencial.html / agenda.html
      sidebar-header
      sidebar-user-card (id="sidebar-avatar" para iniciales de rol)
      sidebar-nav:
        · label "Calendario"
          · Agenda → /panel/agenda.html
          · Presencial → /panel/presencial.html
          · Bloqueos → /panel/bloqueos.html  ← nav-item.active
        · label "Reportes" (id="label-reportes", oculto por defecto)
          · Auditoría (id="nav-auditoria", display:none)
          · Dashboard  (id="nav-dashboard",  display:none)
        · label "Administración" (id="label-admin", oculto por defecto)
          · Usuarios  (id="nav-usuarios",  display:none)
          · Servicios (id="nav-servicios", display:none)
      sidebar-footer (id="nav-nombre" + btn-logout-sidebar)
    </aside>

    <main class="main-content">   ← flex:1, overflow-y:auto, bg: var(--bg-2)

      <div class="page-inner">    ← max-width:900px, margin:auto, padding:2rem 1.5rem

        <div class="page-header">
          <p class="page-supertitle">Panel de gestión</p>
          <h1 class="page-title">Bloqueos</h1>
        </div>

        <!-- Card 1: lista de bloqueos vigentes -->
        <div class="card">
          <div class="card-titulo">
            <span>Bloqueos vigentes</span>
            <button class="btn btn-secondary" onclick="cargarBloqueos()">↻ Actualizar</button>
          </div>

          <!-- chips de área (B9) -->
          <div class="area-selector" id="selector-areas-lista">
            <div class="area-selector-titulo">Filtrar por área</div>
            <div class="area-chips" id="chips-areas-lista"></div>
          </div>

          <div class="alerta alerta-error" id="error-lista"></div>
          <div class="alerta alerta-ok"    id="ok-lista"></div>

          <div class="tabla-wrapper">
            <div id="tabla-bloqueos"><div class="cargando">Cargando bloqueos...</div></div>
          </div>
        </div>

        <!-- Card 2: formulario nuevo bloqueo -->
        <div class="card">
          <div class="card-titulo">Nuevo bloqueo</div>

          <div class="alerta alerta-error" id="error-form"></div>
          <div class="alerta alerta-ok"    id="ok-form"></div>

          <!-- Tipo -->
          <div class="form-grupo">
            <label>Tipo de bloqueo</label>
            <div class="tipo-opciones">
              <div class="tipo-opcion">
                <input type="radio" name="tipo" id="tipo-individual" value="individual" checked onchange="onTipoChange()">
                <label for="tipo-individual">👤 Individual</label>
              </div>
              <div class="tipo-opcion" id="opcion-oficina">
                <input type="radio" name="tipo" id="tipo-oficina" value="oficina" onchange="onTipoChange()">
                <label for="tipo-oficina">🏢 Oficina completa</label>
              </div>
            </div>
            <p class="hint" id="hint-tipo">
              Individual: bloquea a un operador específico. Oficina: bloquea toda el área.
            </p>
          </div>

          <!-- Área (B5) -->
          <div class="form-grupo" id="grupo-area" style="display:none">
            <label for="sel-area">Área</label>
            <select id="sel-area" onchange="onAreaFormChange()"></select>
          </div>

          <!-- Operador -->
          <div class="form-grupo" id="grupo-operador">
            <label for="sel-operador">Operador afectado</label>
            <select id="sel-operador">
              <option value="">— Seleccioná un operador —</option>
            </select>
          </div>

          <hr class="separador">

          <!-- Fechas -->
          <div class="form-fila">
            <div class="form-grupo">
              <label for="fecha-inicio">Fecha inicio</label>
              <input type="date" id="fecha-inicio">
            </div>
            <div class="form-grupo">
              <label for="fecha-fin">Fecha fin</label>
              <input type="date" id="fecha-fin">
            </div>
          </div>

          <!-- Checkbox día completo -->
          <div class="form-grupo">
            <label class="checkbox-label">
              <input type="checkbox" id="dia-completo" onchange="onDiaCompletoChange()">
              Día completo (sin especificar horario)
            </label>
            <p class="hint">Tildá si querés bloquear desde la apertura hasta el cierre de la oficina.</p>
          </div>

          <!-- Horas -->
          <div id="grupo-horas" class="form-fila">
            <div class="form-grupo">
              <label for="hora-inicio">Hora inicio</label>
              <input type="time" id="hora-inicio" step="1800">
            </div>
            <div class="form-grupo">
              <label for="hora-fin">Hora fin</label>
              <input type="time" id="hora-fin" step="1800">
            </div>
          </div>

          <!-- Motivo -->
          <div class="form-grupo">
            <label for="motivo">Motivo <span class="required-mark">*</span></label>
            <textarea id="motivo" placeholder="Ej: Licencia médica, Capacitación, Corte de luz..."></textarea>
          </div>

          <button class="btn btn-primary btn-full" id="btn-crear" onclick="crearBloqueo()">
            Crear bloqueo
          </button>
        </div><!-- .card formulario -->

      </div><!-- .page-inner -->
    </main>

  </div><!-- .app-shell -->

  <script> … idéntico al actual excepto rolBadgeHTML() … </script>

</body>
```

---

## 7. CSS nuevo para el `<style>` interno

Solo lo que design-tokens.css no cubre. Usar únicamente vars.

```css
/* ── Layout ─────────────────────────────────────────────────── */
.app-shell    { display: flex; height: 100vh; overflow: hidden; }
.main-content { flex: 1; overflow-y: auto; background: var(--bg-2); }
.page-inner   { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; }

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

/* ── Card ────────────────────────────────────────────────────── */
.card {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}
.card-titulo {
  font-family: var(--font-ui);
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ── Tabla ───────────────────────────────────────────────────── */
.tabla-wrapper { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th {
  background: var(--bg-2);
  color: var(--text-3);
  font-weight: 600;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.7rem 1rem;
  border-bottom: 2px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
td {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  font-size: var(--text-base);
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--bg-4); }
.vacio   { text-align: center; color: var(--text-3); padding: 2.5rem; }
.cargando { text-align: center; color: var(--text-3); padding: 2rem; font-style: italic; }

/* ── Badges de tipo de bloqueo ───────────────────────────────── */
.badge {
  display: inline-block;
  padding: 0.2rem 0.65rem;
  border-radius: 99px;
  font-size: var(--text-xs);
  font-weight: 600;
  border: 1px solid transparent;
}
.badge-individual { background: var(--blue-dim);  color: var(--blue);  border-color: var(--blue-mid);  }
.badge-oficina    { background: var(--amber-dim); color: var(--amber); border-color: var(--amber-mid); }
.badge-dia-completo { background: var(--bg-4); color: var(--text-3); border-color: var(--border); }

/* ── Alertas ─────────────────────────────────────────────────── */
.alerta { padding: 0.7rem 1rem; border-radius: var(--radius-md); font-size: var(--text-sm); margin-bottom: 1rem; display: none; }
.alerta.visible  { display: block; }
.alerta-error { background: var(--red-dim);  border: 1px solid var(--red-mid);  color: var(--red);  }
.alerta-ok    { background: var(--teal-dim); border: 1px solid var(--teal-mid); color: var(--teal); }

/* ── Área selector de chips (B9) ─────────────────────────────── */
.area-selector { margin-bottom: 1rem; display: none; }
.area-selector.visible { display: block; }
.area-selector-titulo {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.4rem;
}
.area-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }

/* area-chip: mismo estilo que .filter-chip de tokens pero JS usa area-chip */
.area-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid var(--border);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  color: var(--text-2);
  background: transparent;
  transition: var(--transition-fast);
  user-select: none;
}
.area-chip:hover  { background: var(--bg-4); border-color: var(--border-hi); color: var(--text-1); }
.area-chip.activo { background: var(--teal-dim); border-color: var(--teal-mid); color: var(--teal); font-weight: 600; }

/* ── Formulario ──────────────────────────────────────────────── */
.form-fila  { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.form-grupo { margin-bottom: 1rem; }
.form-grupo:last-child { margin-bottom: 0; }
label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: 0.4rem;
}
label .opcional { font-weight: 400; color: var(--text-3); font-size: var(--text-xs); }
input, select, textarea {
  width: 100%;
  padding: 0.55rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-family: var(--font-ui);
  background: var(--bg-4);
  color: var(--text-1);
  transition: var(--transition-fast);
}
input::placeholder, textarea::placeholder { color: var(--text-3); }
input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--border-hi);
  box-shadow: 0 0 0 3px var(--teal-dim);
}
input[type="time"], input[type="date"] { cursor: pointer; }
textarea { resize: vertical; min-height: 80px; }
.hint { font-size: var(--text-xs); color: var(--text-3); margin-top: 0.3rem; }

/* ── Separador horizontal ────────────────────────────────────── */
.separador { border: none; border-top: 1px solid var(--border); margin: 1rem 0; }

/* ── Botón de ancho completo ─────────────────────────────────── */
.btn-full { width: 100%; }

/* ── Required mark ───────────────────────────────────────────── */
.required-mark { color: var(--red); }

/* ── Checkbox día completo ───────────────────────────────────── */
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-2);
  margin: 0;
}
.checkbox-label input[type="checkbox"] {
  width: auto;
  padding: 0;
  border: none;
  cursor: pointer;
  accent-color: var(--teal);
}

/* ── Selector de tipo (radio cards) ──────────────────────────── */
.tipo-opciones { display: flex; gap: 0.75rem; }
.tipo-opcion   { flex: 1; }
.tipo-opcion input[type="radio"] { display: none; }
.tipo-opcion label {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: 600;
  font-size: var(--text-sm);
  text-align: center;
  transition: var(--transition-fast);
  color: var(--text-2);
  margin: 0;
  background: transparent;
}
.tipo-opcion label:hover { border-color: var(--border-hi); color: var(--text-1); background: var(--bg-4); }
.tipo-opcion input[type="radio"]:checked + label {
  border-color: var(--teal-mid);
  background: var(--teal-dim);
  color: var(--teal);
}

/* ── Sidebar (copiado de presencial.html / agenda.html) ──────── */
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
```

---

## 8. Cambios en el bloque `<script>`

Solo se modifica `rolBadgeHTML()` — es una función de presentación que usa estilos inline hardcodeados. Se reescribe para usar las clases del design system:

```javascript
// ANTES (hardcoded inline styles):
function rolBadgeHTML(rol) {
  const cfg = {
    operador:  { bg: '#1e40af', label: 'Operador' },
    encargado: { bg: '#166534', label: 'Encargado' },
    sistemas:  { bg: '#6b21a8', label: 'Sistemas' },
    directivo: { bg: '#374151', label: 'Solo lectura' },
  };
  const { bg, label } = cfg[rol] || { bg: '#374151', label: rol };
  return `<span class="badge-rol" style="background:${bg};color:white;...">...</span>`;
}

// DESPUÉS (clases del design system):
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

> **Nota:** `.role-badge`, `.role-encargado`, `.role-operador`, `.role-sistemas`,
> `.role-directivo` ya están definidos en `design-tokens.css`. La lógica de la
> función (qué rol mapea a qué label) NO cambia.

---

## 9. Inline styles a eliminar del HTML estático

| Elemento | Style inline actual | Solución |
|---|---|---|
| `<span style="color:#dc2626">*</span>` en label Motivo | color rojo hardcoded | `<span class="required-mark">*</span>` + `.required-mark { color: var(--red); }` |
| `style="display:none"` en nav links y `#grupo-area` | control de visibilidad por JS | MANTENER — el JS los manipula con `el.style.display` |

### Inline styles en HTML generado por JS — DEJAR INTACTOS
```javascript
'<em style="color:#64748b">Toda el área</em>'          // en cargarBloqueos() → no tocar
'<span style="color:#94a3b8;font-size:.8rem">—</span>' // en cargarBloqueos() → no tocar
```

---

## 10. Orden de implementación (pasos con checkpoint)

### ~~Paso 1 — Layout shell y sidebar~~ ✅ completado (commit `d6f2d58`)
- ~~Reemplazar `<nav class="navbar">` y todo su CSS por sidebar de agenda.html/presencial.html~~
- ~~Cambiar `.nav-item.active` a "Bloqueos"~~
- ~~HTML del sidebar: incluir `id="sidebar-avatar"`, `id="nav-nombre"`, `id="label-reportes"` y `id="label-admin"` (con `style="display:none"` por defecto), igual que en presencial.html~~
- ~~Wrap del contenido en `.app-shell > .main-content > .page-inner`~~
- ~~Agregar `<link rel="stylesheet" href="/assets/design-tokens.css">` en el `<head>`~~
- ~~CSS: `.app-shell`, `.main-content`, `.page-inner`, sidebar completo, minical~~
- ~~CSS: `page-supertitle`, `page-title`~~
- ~~CSS: CSS completo del plan §7 incluido en este paso (cards, tabla, badges, alertas, formulario)~~
- ~~HTML: bloque `.page-header` con "Panel de gestión" / "Bloqueos"~~
- ~~**JS en `init()`:** agregar bloque de `sidebar-avatar` (iniciales + color por rol) copiado de presencial.html~~
- ~~**JS en `init()`:** agregar `lRep.style.display = ''` y `lAdm.style.display = ''` dentro del bloque que ya muestra los nav links según rol~~
- ~~`rolBadgeHTML()` reescrita para usar `.role-badge .role-XXX` (sin estilos inline)~~
- ~~Inline style `color:#dc2626` en asterisco de Motivo → `.required-mark`~~
- ~~`btn-ghost` → `btn-secondary` en botón "↻ Actualizar"~~
- **Verificado:** 0 hex en `<style>`; 31 IDs obligatorios presentes; navbar vieja eliminada; `renderizarMiniCal` definida y llamada; `sidebar-avatar` + labels en `init()`; `role-badge` sin inline styles

### Paso 2 — Cards y tabla
> **Nota:** el CSS de este paso ya fue incluido en el Paso 1. Solo quedan verificaciones
> de que los nombres de clase coinciden con lo que usa el JS.

- ~~CSS: `.card`, `.card-titulo`~~ (incluido en Paso 1)
- ~~CSS: `.tabla-wrapper`, `table`, `th`, `td`, `tr:hover`, `.vacio`, `.cargando`~~ (incluido en Paso 1)
- ~~CSS: `.badge` base, `.badge-individual`, `.badge-oficina`, `.badge-dia-completo`~~ (incluido en Paso 1)
- ~~CSS: `.alerta`, `.alerta-error`, `.alerta-ok`~~ (incluido en Paso 1)
- ~~CSS: `.area-selector`, `.area-selector-titulo`, `.area-chips`, `.area-chip`, `.area-chip.activo`~~ (incluido en Paso 1)
- HTML: no hay cambios en la estructura del card lista (IDs se mantienen)
- **Checkpoint (estructural):** 0 hex en CSS; `.badge-individual`, `.badge-oficina`, `.badge-dia-completo` y `.area-chip.activo` coinciden con nombres usados en JS; `.alerta.visible` presente

### Paso 3 — Formulario
> **Nota:** el CSS de este paso ya fue incluido en el Paso 1. Solo quedan verificaciones.

- ~~CSS: `label`, `.opcional`, `input`, `select`, `textarea`, `.hint`, `.separador`~~ (incluido en Paso 1)
- ~~CSS: `.form-grupo`, `.form-fila`, `.required-mark`~~ (incluido en Paso 1)
- ~~CSS: `.checkbox-label`~~ (incluido en Paso 1)
- ~~CSS: `.tipo-opciones`, `.tipo-opcion` y estado `:checked`~~ (incluido en Paso 1)
- ~~CSS: `.btn-full`~~ (incluido en Paso 1)
- ~~HTML: reemplazar `<span style="color:#dc2626">` por `<span class="required-mark">`~~ (hecho en Paso 1)
- ~~HTML: `btn-ghost` → `btn-secondary` en botón "↻ Actualizar"~~ (hecho en Paso 1)
- **Checkpoint (estructural):** 0 hex en CSS; 0 `style=` en HTML (salvo los `display:none` funcionales); `.tipo-opcion input:checked + label` presente

### Paso 4 — `rolBadgeHTML()` y limpieza final
> **Nota:** `rolBadgeHTML()` ya fue reescrita en el Paso 1.

- ~~Reescribir `rolBadgeHTML()` para usar `.role-badge .role-XXX`~~ (hecho en Paso 1)
- ~~Eliminar del `<style>` todas las reglas de `.navbar`, `.nav-links`, `.nav-user`, `.btn-logout`~~ (hecho en Paso 1)
- Grep final: `grep -n "#[0-9a-fA-F]\{3,6\}" bloqueos.html` → solo deben aparecer los dos
  hexadecimales en los inline styles de `cargarBloqueos()` (documentados y excluidos)
- **Checkpoint:** `.role-badge` y clases de rol presentes en design-tokens.css;
  `rolBadgeHTML()` sin hexadecimales; 0 hex en `<style>` interno

### Commit por paso
Cada paso hace un commit antes de avanzar al siguiente:
`feat(panel): bloqueos paso N — descripción`
