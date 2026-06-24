# Plan de Rediseño — agenda.html
# Sistema de Turnos Municipal — Villa La Angostura
# Referencia: design_handoff_sistema_turnos/README.md + design-tokens.css

---

## Restricciones que gobiernan todo el trabajo

| Categoría | Regla |
|---|---|
| JS de negocio | No tocar: fetch, JWT, roles, event listeners, estados, alertas, logout |
| JS de presentación | Sí reescribir: `renderizarTablaDia`, `renderizarSemana`, `renderizarMes`, `renderizarStats`, `renderizarBannersDia`, `rolBadgeHTML` |
| HTML estático | Reemplazar completamente: navbar → sidebar, container → main area |
| CSS | Eliminar todos los estilos del `<style>` interno. Usar solo variables de `design-tokens.css` |
| IDs del DOM | Los 15 IDs que lee el JS deben existir en el nuevo HTML (pueden estar en otro contenedor) |
| Clases generadas dinámicamente | Actualizar dentro de las funciones de render para que coincidan con design-tokens.css |
| Vanilla JS | Sin React, sin imports ES6, sin librerías |

---

## Correcciones incorporadas (2026-06-24)

| # | Descripción | Impacto |
|---|---|---|
| C1 | Al mostrar links de rol también mostrar `#label-reportes` y `#label-admin` | Nueva sección "Ajustes JS de presentación" |
| C2 | Los tres divs de nav-fecha ya tenían `class="nav-fecha"` en el HTML original | Sin cambio necesario — ya implementado |
| C3 | Agregar `renderizarMiniCal()` — mini-calendario decorativo para el sidebar | Nueva función documentada abajo |
| C4 | Botón Nueva Reserva → `onclick="window.location.href='/panel/presencial.html'"` | Actualizado en el esqueleto HTML |
| C5 | Documentar riesgo de solapamiento de cards con botones en vista día | Nota agregada en sección renderizarTablaDia |

---

## Inventario de IDs obligatorios

Estos 15 IDs son escritos o leídos por el JS de negocio. Todos deben existir
en el nuevo HTML. La columna "Nueva ubicación" indica dónde van en el nuevo layout.

| ID | Qué hace el JS | Nueva ubicación |
|---|---|---|
| `#btn-vista-dia` | `.classList.toggle('activo', ...)` | Topbar — columna izquierda |
| `#btn-vista-semana` | `.classList.toggle('activo', ...)` | Topbar — columna izquierda |
| `#btn-vista-mes` | `.classList.toggle('activo', ...)` | Topbar — columna izquierda |
| `#nav-dia` | `.style.display = 'flex'/'none'` | Topbar — columna izquierda |
| `#nav-semana` | `.style.display = 'flex'/'none'` | Topbar — columna izquierda |
| `#nav-mes` | `.style.display = 'flex'/'none'` | Topbar — columna izquierda |
| `#fecha-input` | `.value` leído/escrito | Dentro de `#nav-dia` |
| `#label-semana` | `.textContent = ...` | Dentro de `#nav-semana` |
| `#label-mes` | `.textContent = ...` | Dentro de `#nav-mes` |
| `#fecha-label` | `.textContent = ...` | Debajo del topbar / encima de la grilla |
| `#filtro-operador` | `.style.display = 'flex'/'none'` | Filterbar — derecha |
| `#select-operador` | `onchange="cargar()"`, lee `.value` | Dentro de `#filtro-operador` |
| `#selector-areas-agenda` | `.classList.add('visible')` | Filterbar — izquierda |
| `#chips-areas-agenda` | appendChild de chips | Dentro de `#selector-areas-agenda` |
| `#stats` | `innerHTML = chips` | Topbar — columna derecha |
| `#nav-nombre` | `innerHTML = nombre + badge` | Sidebar — user card |
| `#nav-auditoria` | `.style.display = ''/'none'` | Sidebar — nav, grupo Reportes |
| `#nav-dashboard` | `.style.display = ''/'none'` | Sidebar — nav, grupo Reportes |
| `#nav-usuarios` | `.style.display = ''/'none'` | Sidebar — nav, grupo Admin |
| `#nav-servicios` | `.style.display = ''/'none'` | Sidebar — nav, grupo Admin |
| `#tabla-container` | `innerHTML = grilla completa` | Calendar area |
| `#alerta-error` | `.classList.add('visible')`, `.textContent` | Encima de `#tabla-container` |
| `#alerta-ok` | `.classList.add('visible')`, `.textContent` | Encima de `#tabla-container` |
| `#modal-fondo` | `.classList.add/remove('abierto')` | Fixed, fuera del layout |
| `#modal-info` | `.textContent = ...` | Dentro del modal |
| `#motivo-input` | `.value` leído | Dentro del modal |
| `#modal-error` | `.textContent`, `.style.display` | Dentro del modal |
| `#btn-confirmar` | `.disabled`, `.textContent` | Dentro del modal |

---

## Nueva estructura HTML (shell estático)

```
<body>
  <div class="app-shell">                         ← flex-row, height: 100vh

    <aside class="sidebar">                       ← 220px, bg: --bg-1
      <div class="sidebar-header">
        <div class="sidebar-logo">VLA</div>
        <div>
          <div class="sidebar-muni">Municipalidad</div>
          <div class="sidebar-ciudad">Villa La Angostura</div>
        </div>
      </div>
      <div class="sidebar-user-card">
        <div class="sidebar-avatar" id="sidebar-avatar"></div>
        <div>
          <span id="nav-nombre"></span>           ← JS escribe aquí
        </div>
        <button onclick="cerrarSesion()">Salir</button>
      </div>
      <div class="sidebar-minical" id="sidebar-minical"></div>  ← decorativo
      <nav class="sidebar-nav">
        <div class="nav-section-label">Calendario</div>
        <a href="/panel/agenda.html"    class="nav-item active">Agenda</a>
        <a href="/panel/presencial.html" class="nav-item">Presencial</a>
        <a href="/panel/bloqueos.html"   class="nav-item">Bloqueos</a>
        <div class="nav-section-label" id="label-reportes" style="display:none">Reportes</div>
        <a href="/panel/auditoria.html"  class="nav-item" id="nav-auditoria"  style="display:none">Auditoría</a>
        <a href="/panel/dashboard.html"  class="nav-item" id="nav-dashboard"  style="display:none">Dashboard</a>
        <div class="nav-section-label" id="label-admin" style="display:none">Admin.</div>
        <a href="/panel/usuarios.html"        class="nav-item" id="nav-usuarios"  style="display:none">Usuarios</a>
        <a href="/panel/servicios-admin.html" class="nav-item" id="nav-servicios" style="display:none">Servicios</a>
      </nav>
    </aside>

    <div class="main-area">                       ← flex-col, flex:1, bg: --bg-2

      <div class="topbar">                        ← 54px, 3 columnas
        <div class="topbar-left">
          <span class="topbar-title">Agenda</span>
          <div class="btn-group-vista">           ← toggle Día/Semana/Mes
            <button id="btn-vista-dia"    class="btn-vista activo" onclick="cambiarVista('dia')">Día</button>
            <button id="btn-vista-semana" class="btn-vista"        onclick="cambiarVista('semana')">Semana</button>
            <button id="btn-vista-mes"    class="btn-vista"        onclick="cambiarVista('mes')">Mes</button>
          </div>
          <div id="nav-dia">
            <button onclick="moverFecha(-1)">◀</button>
            <input type="date" id="fecha-input" onchange="onFechaChange()">
            <button onclick="moverFecha(+1)">▶</button>
            <button onclick="irAHoy()">Hoy</button>
          </div>
          <div id="nav-semana" style="display:none">
            <button onclick="moverSemana(-1)">◀</button>
            <span id="label-semana"></span>
            <button onclick="moverSemana(+1)">▶</button>
            <button onclick="irASemanaActual()">Esta semana</button>
          </div>
          <div id="nav-mes" style="display:none">
            <button onclick="moverMes(-1)">◀</button>
            <span id="label-mes"></span>
            <button onclick="moverMes(+1)">▶</button>
            <button onclick="irAMesActual()">Este mes</button>
          </div>
        </div>
        <div class="topbar-center">
          <input class="search-global" type="text"
                 placeholder="Buscar vecino, DNI, n.º turno…">
        </div>
        <div class="topbar-right">
          <div id="stats"></div>                  ← JS escribe aquí
          <!-- C4: solución provisional hasta que se implemente el drawer presencial -->
          <button class="btn btn-primary" onclick="window.location.href='/panel/presencial.html'">+ Nueva Reserva</button>
        </div>
      </div>

      <div class="filterbar">                     ← 36px
        <div class="filterbar-left">
          <span class="filterbar-label">Área</span>
          <div id="selector-areas-agenda">
            <div id="chips-areas-agenda"></div>
          </div>
        </div>
        <div class="filterbar-right">
          <div id="filtro-operador" style="display:none">
            <select id="select-operador" onchange="cargar()">
              <option value="">Todos los operadores</option>
            </select>
          </div>
        </div>
      </div>

      <div class="calendar-area">                 ← flex:1, overflow-y:auto
        <p id="fecha-label" class="fecha-label-bar"></p>
        <div class="alerta alerta-error" id="alerta-error"></div>
        <div class="alerta alerta-ok"    id="alerta-ok"></div>
        <div id="tabla-container">
          <div class="cargando">Cargando agenda...</div>
        </div>
      </div>

    </div>  <!-- /main-area -->
  </div>    <!-- /app-shell -->

  <!-- Modal cancelar (igual que hoy, solo restyled) -->
  <div class="modal-fondo" id="modal-fondo">
    <div class="modal-caja">
      <h3>Cancelar turno</h3>
      <p id="modal-info"></p>
      <label>Motivo de cancelación</label>
      <textarea id="motivo-input" rows="3" placeholder="Describí el motivo..."></textarea>
      <div id="modal-error" class="alerta alerta-error" style="margin-top:.75rem"></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="cerrarModal()">Volver</button>
        <button class="btn btn-danger" id="btn-confirmar" onclick="confirmarCancelacion()">
          Confirmar cancelación
        </button>
      </div>
    </div>
  </div>
```

---

## Funciones de render — qué cambia

### `renderizarStats(turnos)` — reescribir

**Genera actualmente:** `.stat-chip.chip-total`, `.stat-chip.chip-agendado`, etc.
**Debe generar:** `.topbar-counter.counter-total`, `.topbar-counter.counter-agendado`, etc.

Ejemplo del HTML nuevo:
```html
<div class="topbar-counter counter-total">
  <span class="counter-num">12</span>
  <span class="counter-label">Total</span>
</div>
<div class="topbar-counter counter-agendado">
  <span class="counter-num">8</span>
  <span class="counter-label">Agendados</span>
</div>
<!-- ... presente, ausente -->
```

Nota: `counter-total`, `counter-agendado`, `counter-presente`, `counter-ausente`
ya están definidos en `design-tokens.css`. No agregar CSS nuevo para esto.

---

### `renderizarSemana(turnos, dias)` — reescribir completamente

**Estructura que debe generar dentro de `#tabla-container`:**

```html
<div class="cal-week-wrapper">
  <div class="cal-time-col">
    <div class="cal-time-header"></div>   <!-- espacio vacío arriba del encabezado -->
    <div class="cal-time-slot">08:00</div>
    <div class="cal-time-slot">08:30</div>
    <!-- ... hasta 17:30 -->
  </div>
  <div class="cal-days-area">
    <!-- 7 columnas, una por día -->
    <div class="cal-day-col" data-state="normal|today|blocked|holiday|closed">
      <div class="cal-day-header">
        <span class="cal-day-name">LUN</span>
        <span class="cal-day-num">23</span>
        <!-- si bloqueado: -->
        <span class="cal-day-badge-blocked">BLOQUEADO</span>
        <span class="cal-day-block-info">Nombre Op — Motivo</span>
        <!-- si tiene turnos: -->
        <span class="cal-day-count">3 turnos</span>
      </div>
      <div class="cal-day-body">
        <!-- overlay diagonal para días bloqueados: -->
        <div class="day-blocked-overlay"></div>
        <div class="day-blocked-watermark">BLOQUEADO</div>
        <!-- cards de turno (position: absolute) -->
        <div class="turno-card turno-blue" style="top: Xpx">
          <div class="turno-row-1">
            <span class="turno-hora font-mono">09:30</span>
            <span class="turno-avatar">JG</span>
          </div>
          <div class="turno-nombre">Juan García</div>
          <span class="svc-badge svc-blue">LIC</span>
        </div>
        <!-- zona de agregar turno (solo en hoy): -->
        <div class="agregar-turno-zone">+ Agregar turno</div>
      </div>
    </div>
    <!-- ... 6 columnas más -->
  </div>
</div>
```

**Cálculo de `top` para cada card:**
```
hora = parseInt(t.hora_inicio.substring(0, 2))
mins = parseInt(t.hora_inicio.substring(3, 5))
fila = (hora - 8) * 2 + (mins >= 30 ? 1 : 0)
top  = fila * 44 + 2  // +2px de margen interno
```

**Color de card según servicio:**
- Licencia de Conducir (serviceId 2): `turno-blue`
- Tribunal de Faltas (serviceId 3): `turno-teal`
- Otros: `turno-red`
- También aplicar color por estado si el servicio no se puede determinar:
  - agendado → turno-blue
  - presente → turno-teal
  - ausente  → turno-red
  - atendido → turno-red (con opacity reducida via clase)

**Iniciales del operador:**
```js
function inicialesOp(nombre) {
  if (!nombre) return '?';
  return nombre.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
}
```

**Estado del día (data-state):**
- `today`: fecha === HOY
- `blocked`: `diasEspeciales.bloqueados.has(fecha)`
- `holiday`: `diasEspeciales.feriados.has(fecha)`
- `closed`: sábado o domingo (no hay atención)
- `normal`: resto

Los fondos del header y celda se controlan desde CSS usando
`[data-state="today"] .cal-day-header { background: var(--day-hdr-today); }` etc.

**Alto total de `cal-day-body`:**
```
slots = generarSlotsTiempo('08:00', '17:30').length  // = 20 slots
alto  = 20 * 44  // = 880px
```
La columna del cuerpo del día necesita `min-height: 880px; position: relative`.

**Líneas de hora (decorativas):**
Generadas como `<div class="hora-line hora-line-full">` o `.hora-line-half`
a intervalos de 44px. El JS las genera junto con el cuerpo del día.

---

### `renderizarTablaDia(turnos)` — reescribir

La vista día usa la misma grilla que la semana, pero con una sola columna.
El `#tabla-container` recibe la misma estructura `.cal-week-wrapper` pero
con `.cal-days-area` conteniendo un único `.cal-day-col`.

Las cards son horizontales (más anchas) porque tienen todo el ancho disponible.
Incluir: hora / avatar operador / nombre vecino (flex:1) / badge servicio / badge estado + botones de acción.

Dado que la vista día tiene botones de acción por fila, el alto de la card
no puede ser fijo en 40px cuando hay botones. Usar `height: auto; min-height: 40px`.

> **C5 — Riesgo conocido:** dos turnos en slots consecutivos (ej. 08:00 y 08:30)
> pueden solaparse visualmente cuando el primero tiene botones de acción y su
> altura excede 44px. Pendiente resolver en iteración posterior con scroll interno
> o drawer de detalle al hacer click.

Los botones Tomar / Presente / Ausente / Liberar / Cancelar se incluyen dentro
de la card como una fila de acción al pie.

---

### `renderizarMes(turnos, año, mes)` — leve ajuste de clases

La lógica de celdas no cambia. Solo actualizar las clases CSS para que
usen los tokens del design system:
- Eliminar colores hardcodeados (`.cal-feriado { background: #fef2f2 }`)
- Usar variables: `--day-bg-holiday`, `--day-color-holiday`, `--day-hdr-holiday`
- El grid de 7 columnas se mantiene
- Ajustar `.cal-dia` para que use `--bg-3`, border `--border`, etc.

---

### `renderizarBannersDia()` — ajuste de clases

Reemplazar `.banner-feriado`, `.banner-bloqueado`, `.banner-bloqueado-ind`
por versiones que usen variables del design system. No cambiar la lógica
de cuándo se muestran.

---

### `renderizarMiniCal()` — función nueva (C3)

Mini-calendario decorativo del sidebar. Sin lógica de datos.
Muestra el mes actual con el día de hoy destacado en `--teal`.
Llamar **una sola vez** desde `init()`.

```js
function renderizarMiniCal() {
  const container = document.getElementById('sidebar-minical');
  if (!container) return;

  const hoy    = new Date();
  const año    = hoy.getFullYear();
  const mes    = hoy.getMonth();      // 0-based
  const diaHoy = hoy.getDate();

  // Días de la semana actual (para resaltarlos)
  const lunes = new Date(hoy);
  const diff  = lunes.getDay() === 0 ? -6 : 1 - lunes.getDay();
  lunes.setDate(lunes.getDate() + diff);
  const domingoDeSemana = new Date(lunes);
  domingoDeSemana.setDate(domingoDeSemana.getDate() + 6);

  const MESES = ['Ene','Feb','Mar','Abr','May','Jun',
                 'Jul','Ago','Sep','Oct','Nov','Dic'];
  const DOWS  = ['L','M','X','J','V','S','D'];

  // Headers de días de la semana
  const headers = DOWS.map(d =>
    `<div class="minical-dow">${d}</div>`
  ).join('');

  // Primer día del mes y lunes de esa semana
  const primerDia = new Date(año, mes, 1);
  const diaSemana = primerDia.getDay();
  const initOffset = diaSemana === 0 ? 6 : diaSemana - 1;
  const primerCelda = new Date(año, mes, 1 - initOffset);

  // 35 celdas (5 semanas × 7 días)
  const celdas = [];
  const cur = new Date(primerCelda);
  for (let i = 0; i < 35; i++) {
    const esDelMes = cur.getMonth() === mes;
    const esHoy    = esDelMes && cur.getDate() === diaHoy;
    // ¿Está dentro de la semana actual?
    const enSemana = !esHoy && cur >= lunes && cur <= domingoDeSemana;
    const cls = esHoy    ? 'minical-cell hoy'
              : enSemana ? 'minical-cell en-semana'
              : !esDelMes ? 'minical-cell otro-mes'
              : 'minical-cell';
    celdas.push(`<div class="${cls}">${cur.getDate()}</div>`);
    cur.setDate(cur.getDate() + 1);
  }

  container.innerHTML = `
    <div class="minical">
      <div class="minical-header">${MESES[mes]} ${año}</div>
      <div class="minical-grid">${headers}${celdas.join('')}</div>
    </div>
  `;
}
```

---

### `rolBadgeHTML(rol)` — ajuste de clases

Actualmente genera `style="background:${bg};color:white"` con colores hardcodeados.
Reemplazar por clases del design system:
```js
function rolBadgeHTML(rol) {
  const clases = {
    operador:  'role-badge role-operador',
    encargado: 'role-badge role-encargado',
    sistemas:  'role-badge role-sistemas',
    directivo: 'role-badge role-directivo',
  };
  const labels = {
    operador: 'Operador', encargado: 'Encargado',
    sistemas: 'Sistemas', directivo: 'Solo lectura',
  };
  const cls   = clases[rol]  || 'role-badge role-sistemas';
  const label = labels[rol] || rol;
  return `<span class="${cls}">${label}</span>`;
}
```
Las clases `.role-badge`, `.role-encargado`, etc. ya existen en `design-tokens.css`.

---

### `init()` — ajustes de presentación (C1)

Dentro del bloque que muestra los links de rol, también mostrar los labels de sección
del sidebar. Solo aplica cuando el sidebar esté en el DOM (Paso 3 en adelante).

```js
// Bloque existente (no tocar):
if (['encargado', 'sistemas', 'directivo'].includes(usuario.rol)) {
  ['nav-auditoria', 'nav-dashboard', 'nav-usuarios', 'nav-servicios'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  // C1: mostrar también los labels de sección del sidebar
  const labelReportes = document.getElementById('label-reportes');
  if (labelReportes) labelReportes.style.display = '';
  const labelAdmin = document.getElementById('label-admin');
  if (labelAdmin) labelAdmin.style.display = '';
}

// Llamar renderizarMiniCal una vez al final de init()
renderizarMiniCal();
```

---

## CSS nuevo que agregar en `<style>` (solo lo que no cubre design-tokens.css)

`design-tokens.css` ya provee: `.turno-card`, `.turno-blue/teal/red`, `.svc-badge`,
`.filter-chip`, `.topbar-counter`, `.nav-item`, `.btn`, `.btn-primary/secondary/danger`,
`.day-blocked-overlay`, `.day-blocked-watermark`, `.agregar-turno-zone`, `.slot-horario`,
`.audit-badge`, `.role-badge`, `.area-badge`, `.kpi-card`, `.drawer`, `.drawer-overlay`,
`.banner-en-atencion`, `.toggle`, `.input-base`, `.search-global`.

El `<style>` interno solo debe agregar:

```css
/* Layout shell */
.app-shell { display: flex; height: 100vh; overflow: hidden; }

/* Sidebar */
.sidebar { width: var(--sidebar-width); background: var(--bg-1);
           border-right: 1px solid var(--border); display: flex;
           flex-direction: column; flex-shrink: 0; overflow-y: auto; }
.sidebar-header { display: flex; align-items: center; gap: var(--gap-sm);
                  padding: 14px 12px 10px; border-bottom: 1px solid var(--border); }
.sidebar-logo { width: 36px; height: 36px; border-radius: var(--radius-xl);
                background: var(--teal-dim); color: var(--teal); display: flex;
                align-items: center; justify-content: center;
                font-size: 11px; font-weight: 800; flex-shrink: 0; }
.sidebar-muni  { font-size: 8.5px; font-weight: 700; text-transform: uppercase;
                 letter-spacing: 0.05em; color: var(--text-3); }
.sidebar-ciudad { font-size: 12.5px; font-weight: 700; color: var(--text-1); }
.sidebar-user-card { margin: 8px; padding: 7px 9px; border-radius: var(--radius-md);
                     display: flex; align-items: center; gap: var(--gap-sm); }
.sidebar-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex;
                  align-items: center; justify-content: center;
                  font-size: var(--text-xs); font-weight: 700; flex-shrink: 0; }
.nav-section-label { font-size: 8.5px; font-weight: 700; text-transform: uppercase;
                     letter-spacing: 0.1em; color: var(--text-3);
                     padding: 10px 12px 4px; }
.sidebar-nav { padding: 0 6px; flex: 1; }
.nav-item { /* ya en design-tokens.css */ text-decoration: none; }

/* Main area */
.main-area { flex: 1; display: flex; flex-direction: column;
             background: var(--bg-2); overflow: hidden; }

/* Topbar */
.topbar { height: var(--topbar-height); background: var(--bg-1);
          border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: var(--gap-lg);
          padding: 0 16px; flex-shrink: 0; }
.topbar-left  { display: flex; align-items: center; gap: var(--gap-md); flex: 1; }
.topbar-center { flex-shrink: 0; }
.topbar-right  { display: flex; align-items: center; gap: var(--gap-md); flex-shrink: 0; }
.topbar-title { font-size: var(--text-lg); font-weight: 700; color: var(--text-1); }

/* Toggle de vista Día/Semana/Mes */
.btn-group-vista { display: inline-flex; border: 1px solid var(--border);
                   border-radius: var(--radius-md); overflow: hidden; }
.btn-vista { background: transparent; border: none; border-right: 1px solid var(--border);
             padding: 4px 10px; font-size: var(--text-sm); font-weight: 500;
             color: var(--text-2); cursor: pointer; font-family: var(--font-ui);
             transition: var(--transition-fast); }
.btn-vista:last-child { border-right: none; }
.btn-vista.activo { background: var(--teal-dim); color: var(--teal); }
.btn-vista:hover:not(.activo) { background: var(--bg-4); color: var(--text-1); }

/* Navegación de fecha */
.nav-fecha { display: flex; align-items: center; gap: var(--gap-xs); }
.nav-fecha button { background: transparent; border: 1px solid var(--border);
                    border-radius: var(--radius-sm); padding: 3px 8px;
                    font-size: var(--text-sm); color: var(--text-2);
                    cursor: pointer; font-family: var(--font-ui);
                    transition: var(--transition-fast); }
.nav-fecha button:hover { border-color: var(--border-hi); color: var(--text-1); }
.nav-fecha input[type="date"] { background: var(--bg-3); border: 1px solid var(--border);
                                border-radius: var(--radius-sm); padding: 3px 8px;
                                font-size: var(--text-sm); color: var(--text-1);
                                font-family: var(--font-ui); cursor: pointer; }
.periodo-label { font-size: var(--text-sm); color: var(--text-2); font-weight: 500; }

/* Filterbar */
.filterbar { height: var(--filterbar-height); background: var(--bg-2);
             border-bottom: 1px solid var(--border);
             display: flex; align-items: center; justify-content: space-between;
             padding: 0 16px; gap: var(--gap-md); flex-shrink: 0; }
.filterbar-left  { display: flex; align-items: center; gap: var(--gap-sm); }
.filterbar-right { display: flex; align-items: center; gap: var(--gap-sm); }
.filterbar-label { font-size: var(--text-sm); font-weight: 600; color: var(--text-3); }
#selector-areas-agenda { display: flex; align-items: center; gap: var(--gap-xs); }
#filtro-operador select { background: var(--bg-3); border: 1px solid var(--border);
                          border-radius: var(--radius-md); color: var(--text-1);
                          padding: 4px 8px; font-size: var(--text-sm);
                          font-family: var(--font-ui); cursor: pointer; }

/* Calendar area */
.calendar-area { flex: 1; overflow-y: auto; padding: 0; display: flex;
                 flex-direction: column; }
.fecha-label-bar { font-size: var(--text-sm); font-weight: 600; color: var(--text-2);
                   padding: 8px 16px 4px; }

/* Alertas */
.alerta { padding: 8px 16px; font-size: var(--text-base); display: none; }
.alerta.visible { display: block; }
.alerta-error { background: var(--red-dim); border-bottom: 1px solid var(--red-mid);
                color: var(--red); }
.alerta-ok    { background: var(--teal-dim); border-bottom: 1px solid var(--teal-mid);
                color: var(--teal); }

/* Estados de carga y vacío */
.cargando { text-align: center; color: var(--text-3); padding: 3rem;
            font-style: italic; font-size: var(--text-base); }
.vacio    { text-align: center; color: var(--text-3); padding: 3rem; }
.vacio p  { margin-top: 0.5rem; font-size: var(--text-sm); }

/* Grilla calendario — week/day layout */
.cal-week-wrapper { display: flex; flex: 1; padding: 0; }
.cal-time-col { width: var(--hora-col-width); flex-shrink: 0;
                display: flex; flex-direction: column; }
.cal-time-header { height: 52px; flex-shrink: 0; }  /* altura del encabezado de día */
.cal-time-slot { height: var(--slot-height); display: flex; align-items: flex-start;
                 justify-content: flex-end; padding: 2px 6px 0 0;
                 font-family: var(--font-mono); font-size: var(--text-xs);
                 color: var(--text-3); flex-shrink: 0; }
.cal-days-area { flex: 1; display: flex; overflow-x: auto; }

/* Columna de día */
.cal-day-col { flex: 1; min-width: 0; display: flex; flex-direction: column;
               border-left: 1px solid var(--border); }
.cal-day-col:first-child { border-left: none; }
.cal-day-header { height: 52px; flex-shrink: 0; padding: 6px 8px;
                  display: flex; flex-direction: column; align-items: center;
                  justify-content: center; gap: 2px;
                  transition: background 0.15s; }
.cal-day-col[data-state="today"]   .cal-day-header { background: var(--day-hdr-today); }
.cal-day-col[data-state="blocked"] .cal-day-header { background: var(--day-hdr-blocked); }
.cal-day-col[data-state="holiday"] .cal-day-header { background: var(--day-hdr-holiday); }
.cal-day-col[data-state="closed"]  .cal-day-header { background: var(--day-hdr-closed); }
.cal-day-name { font-size: var(--text-xs); font-weight: 700; text-transform: uppercase;
                color: var(--text-3); }
.cal-day-col[data-state="today"]   .cal-day-name { color: var(--teal); }
.cal-day-col[data-state="blocked"] .cal-day-name { color: var(--blue); }
.cal-day-col[data-state="holiday"] .cal-day-name { color: var(--red); }
.cal-day-col[data-state="closed"]  .cal-day-name { color: var(--text-3); }
.cal-day-num { font-family: var(--font-mono); font-size: var(--text-2xl);
               font-weight: 800; line-height: 1; color: var(--text-2); }
.cal-day-col[data-state="today"]   .cal-day-num { color: var(--teal); }
.cal-day-col[data-state="blocked"] .cal-day-num { color: var(--blue); }
.cal-day-col[data-state="holiday"] .cal-day-num { color: var(--red); }
.cal-day-col[data-state="closed"]  .cal-day-num { color: var(--text-3); }
.cal-day-badge-blocked { font-size: var(--text-xs); font-weight: 700;
                         text-transform: uppercase; letter-spacing: 0.08em;
                         color: var(--blue); background: var(--blue-dim);
                         border: 1px solid var(--blue-mid);
                         border-radius: var(--radius-sm); padding: 1px 4px; }
.cal-day-block-info { font-size: 8px; color: var(--text-3); text-align: center; }
.cal-day-count { font-size: 8px; color: var(--text-3); }

/* Cuerpo de día — contenedor de cards absolutas */
.cal-day-body { position: relative; flex: 1; }
.cal-day-col[data-state="today"]   .cal-day-body { background: var(--day-bg-today); }
.cal-day-col[data-state="blocked"] .cal-day-body { background: var(--day-bg-blocked); }
.cal-day-col[data-state="holiday"] .cal-day-body { background: var(--day-bg-holiday); }
.cal-day-col[data-state="closed"]  .cal-day-body { background: var(--day-bg-closed); }

/* Líneas horizontales de hora */
.hora-line { position: absolute; left: 0; right: 0; height: 1px; pointer-events: none; }
.hora-line-full { background: var(--hora-line-full); }
.hora-line-half { background: var(--hora-line-half); }

/* Cards de turno — layout interno */
.turno-card-inner { display: flex; flex-direction: column; height: 100%; }
.turno-row-1 { display: flex; align-items: center; justify-content: space-between;
               gap: var(--gap-xs); }
.turno-hora  { font-family: var(--font-mono); font-size: 9.5px; }
.turno-avatar { width: 17px; height: 17px; border-radius: 50%; display: flex;
                align-items: center; justify-content: center;
                font-size: 7px; font-weight: 700; flex-shrink: 0; }
.turno-nombre { font-size: var(--text-sm); font-weight: 700; color: var(--text-1);
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Colores de avatar por clase de turno */
.turno-blue .turno-avatar { background: var(--blue-mid); color: var(--blue); }
.turno-teal .turno-avatar { background: var(--teal-mid); color: var(--teal); }
.turno-red  .turno-avatar { background: var(--red-mid);  color: var(--red); }
.turno-blue .turno-hora   { color: var(--blue); }
.turno-teal .turno-hora   { color: var(--teal); }
.turno-red  .turno-hora   { color: var(--red); }

/* Vista día — acciones dentro de la card expandida */
.turno-acciones { display: flex; gap: var(--gap-xs); flex-wrap: wrap;
                  margin-top: var(--gap-xs); }

/* Vista mes */
.vista-mes { padding: 12px 16px; flex: 1; }
.cal-header-dias { display: grid; grid-template-columns: repeat(7, 1fr);
                   gap: 3px; margin-bottom: 4px; }
.cal-nombre-dia { text-align: center; font-size: var(--text-xs); font-weight: 700;
                  color: var(--text-3); padding: 4px 0; text-transform: uppercase;
                  letter-spacing: 0.04em; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.cal-dia { border: 1px solid var(--border); border-radius: var(--radius-md);
           padding: 6px 8px; min-height: 64px; cursor: pointer;
           transition: var(--transition-fast); display: flex;
           flex-direction: column; gap: 4px; background: var(--bg-3); }
.cal-dia:hover { background: var(--bg-4); border-color: var(--border-hi); }
.cal-dia.otro-mes { opacity: 0.3; pointer-events: none; }
.cal-dia.cal-hoy { border-color: var(--teal); background: var(--teal-dim); }
.cal-num { font-family: var(--font-mono); font-size: var(--text-base);
           font-weight: 600; color: var(--text-2); }
.cal-hoy .cal-num { color: var(--teal); }
.cal-dia.cal-feriado   { background: var(--day-bg-holiday); border-color: var(--red-mid); }
.cal-dia.cal-bloqueado { background: var(--day-bg-blocked); border-color: var(--blue-mid); }
.cal-dia.cal-feriado   .cal-num { color: var(--red); }
.cal-dia.cal-bloqueado .cal-num { color: var(--blue); }
.cal-count { background: var(--teal); color: var(--bg-0); border-radius: 99px;
             font-size: 9px; font-weight: 700; padding: 1px 6px; align-self: flex-start; }
.cal-indicador { font-size: var(--text-xs); font-weight: 600; line-height: 1; }
.cal-indicador.feriado { color: var(--red); }
.cal-indicador.bloqueado { color: var(--blue); }
.cal-indicador.bloqueado-ind { color: var(--blue); }

/* Modal cancelar */
.modal-fondo { display: none; position: fixed; inset: 0;
               background: var(--drawer-overlay); z-index: 200;
               align-items: center; justify-content: center; padding: 1rem; }
.modal-fondo.abierto { display: flex; }
.modal-caja { background: var(--bg-3); border: 1px solid var(--border);
              border-radius: var(--radius-lg); padding: 24px; max-width: 460px;
              width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
.modal-caja h3 { font-size: var(--text-xl); font-weight: 800; color: var(--text-1);
                 margin-bottom: 6px; }
.modal-info { color: var(--text-2); font-size: var(--text-sm); margin-bottom: 16px; }
.modal-caja label { display: block; font-size: var(--text-sm); font-weight: 600;
                    color: var(--text-2); margin-bottom: 6px; }
.modal-caja textarea { width: 100%; background: var(--bg-4); border: 1px solid var(--border);
                       border-radius: var(--radius-md); color: var(--text-1);
                       padding: 8px 10px; font-size: var(--text-base);
                       font-family: var(--font-ui); resize: vertical; }
.modal-caja textarea:focus { border-color: var(--border-hi); outline: none; }
.modal-footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }

/* Badge de sin tomar (operador no asignado) */
.badge-sin-tomar { font-size: var(--text-xs); font-weight: 600; color: var(--text-3);
                   background: var(--bg-4); border: 1px solid var(--border);
                   border-radius: 20px; padding: 2px 8px; display: inline-block; }
```

---

## Orden de implementación (una tarea por commit)

Cada paso se trabaja solo, se verifica que el JS siga funcionando, y se hace commit antes del siguiente.

### Paso 1 — Base: link a design-tokens.css + eliminar CSS obsoleto ✅ COMPLETADO (2026-06-24 · commit 5a0b630)

- ✅ Agregado `<link rel="stylesheet" href="/assets/design-tokens.css">` en el `<head>`
- ✅ Eliminado el bloque `<style>` viejo (~195 líneas, colores hardcodeados)
- ✅ Agregado `<style>` nuevo (~380 líneas, solo variables `var(--)`)
- ✅ Incluidos estilos transicionales para clases legacy que usan el JS actual:
  `.btn-ghost`, `.btn-success`, `.btn-warning`, `.badge-agendado/presente/ausente/atendido`,
  `.turno-semana`, tablas `<table>/<th>/<td>`, `.banner-dia`, `.area-chip`, `.badge-rol`
- ✅ Verificación: cero errores JS en consola
- ✅ Verificación: `/assets/design-tokens.css` responde HTTP 200 y se carga correctamente
- ✅ Verificación: `<head>` contiene ambos links (favicon + design-tokens.css)
- ✅ Verificación: auth funciona (redirige a login en 401 como se espera)
- Nota: página visualmente rota (esperado — estructura HTML aún sin cambios)

### Paso 2 — Shell: sidebar + main area ✅ COMPLETADO (2026-06-24 · commit 0ab97e6)
- ✅ Reemplazado `<nav class="navbar">` + `<div class="container">` por app-shell con sidebar + main-area
- ✅ Todos los 28 IDs del inventario existen en el DOM en sus nuevas posiciones
- ✅ `#modal-fondo` es el último elemento del `<body>`, fuera del `app-shell` (línea 744)
- ✅ Cero errores en consola; init() redirige a login correctamente (sin token)
- ✅ Sidebar incluye header VLA, user-card (nav-nombre), minical placeholder, nav groups con label-reportes/label-admin

### Paso 3 — Sidebar: contenido completo ✅ COMPLETADO (2026-06-24 · commit ccc7cdb)
- ✅ `renderizarMiniCal()` — función nueva de presentación; genera 35 celdas con hoy en teal sólido y semana actual en teal-dim
- ✅ Avatar `#sidebar-avatar` — iniciales + fondo por rol: encargado=teal-mid, operador=blue-mid, sistemas/directivo=amber-mid
- ✅ Labels `#label-reportes` y `#label-admin` — se muestran junto a sus links cuando el rol lo permite (C1 del plan)
- ✅ `renderizarMiniCal()` llamada al final de init(), después de toda la lógica de negocio
- ✅ Cero líneas existentes modificadas; solo código nuevo agregado
- ✅ Cero errores en consola; auth redirige a login correctamente

### Paso 4 — Topbar: 3 columnas ✅ COMPLETADO (2026-06-24 · commit c8ea14f)
- ✅ Toggle Día/Semana/Mes: cambiarVista() funciona en los 3 modos; btn.activo tiene fondo --teal-dim
- ✅ Navegación de fechas: moverFecha(), moverSemana(), moverMes(), irAHoy() OK
- ✅ #nav-dia, #nav-semana, #nav-mes: todos tienen clase nav-fecha y display correcto
- ✅ #stats existe (display:flex), buscador .search-global a 340px (o fluido en pantallas angostas)
- ✅ Cero errores JS en consola
- Fix: topbar-left tenía width:0 a <1100px → aplicado flex: 1 1 200px y topbar-center: 0 1 340px
  (el right quedará compacto definitivamente en Paso 6 al reescribir renderizarStats)

### Paso 5 — Filterbar ✅ COMPLETADO (2026-06-24 · commit dc32719)
- ✅ `inicializarChipsAgenda()`: clases `area-chip`/`activo` → `filter-chip`/`active`
- ✅ `areasParam()`: selectores `.area-chip.activo` → `.filter-chip.active`
- ✅ CSS legacy `.area-chip` eliminado; reemplazado por `.filter-chip` de design-tokens.css
- ✅ Dropdown `#filtro-operador select`: ya tenía estilos correctos (sin cambios)
- ✅ Filterbar 36px alto, elementos centrados; toggle ON/OFF verificado; cero errores consola

### Paso 6 — renderizarStats() ✅ COMPLETADO (2026-06-24 · commit 5bafb76)
- ✅ HTML generado: 4 `topbar-counter` (total/agendado/presente/ausente); `atendido` va al Total sin counter propio
- ✅ Colores: gris/azul/teal/rojo desde design-tokens.css ✓ sin CSS nuevo
- ✅ topbar-right baja de 438px a 394px; topbar-left sube de 90px a 106px a 961px
- Nota: fix flex de Paso 4 sigue siendo necesario a <1050px; se revisa en Paso 10

### Paso 7 — renderizarSemana() ✅ COMPLETADO (2026-06-24)
- ✅ `.cal-week-wrapper` con `.cal-time-col` (08:00–17:30, :30 sin texto) y `.cal-days-area`
- ✅ 7 `.cal-day-col` con `data-state` correcto: today/holiday/blocked/closed/normal
- ✅ Cards `position:absolute` con `top = fila*44+2`; turno 10:30 → top=222px verificado
- ✅ Colores por serviceId: 2→turno-blue/LIC, 3→turno-teal/TRI, null→fallback por estado
- ✅ Iniciales del operador (CP, LG) y badge `?` cuando `operador_nombre` es null
- ✅ Overlays: `day-blocked-overlay` + `day-blocked-watermark "BLOQUEADO"/"FERIADO"` en blocked/holiday
- ✅ `.agregar-turno-zone` solo en el día `today` y no en cerrados
- ✅ `inicialesOp()` y `abrirDetalleTurno()` (stub → navega a vista día) agregadas
- ✅ Cero errores en consola; bloqueos individuales muestran info en header

### Paso 8 — renderizarTablaDia() ✅ COMPLETADO (2026-06-24)
- ✅ Misma grilla `.cal-week-wrapper` que semana pero con columna única `.cal-day-col`
- ✅ Cards expandidas: `height:auto; min-height:40px`; nombre con `flex:1` en `turno-row-1`
- ✅ Botones correctos por estado: sin operador+agendado→Tomar/Cancelar; con operador+agendado→Presente/Ausente/Liberar; otros→sin botones; directivo→sin botones
- ✅ Clases design system: btn-secondary/Tomar, btn-primary/Presente, btn-danger/Ausente+Cancelar, btn-secondary/Liberar
- ✅ `.turno-card .btn { font-size:var(--text-xs); padding:3px 8px }` agregado al `<style>`
- ✅ Overlay + watermark en días bloqueados/feriados; data-state correcto
- ✅ `abrirCancelar(id)` abre `#modal-fondo` con info del vecino — verificado
- ✅ Columna de horas (08:00–17:30, 20 slots) visible a la izquierda
- ✅ `.agregar-turno-zone` solo en el día de hoy
- ✅ Cero errores en consola; posiciones: 08:00→2px, 09:30→134px, 11:00→266px, 14:30→574px

### Paso 9 — renderizarMes()
- Ajustar clases CSS a design tokens (eliminar colores hardcodeados)
- Verificar: celdas de feriado/bloqueo tienen colores correctos,
  click en día navega a vista día

### Paso 10 — Pulido final
- `rolBadgeHTML()` → usar clases role-badge
- `renderizarBannersDia()` → actualizar clases a design tokens
- Verificar que el modal de cancelación funciona completo
- Ajustar scrollbar en calendar-area

---

## Verificaciones transversales (después de cada paso)

1. Abrir consola del browser — cero errores JS
2. Los 27 IDs del inventario existen en el DOM
3. El flujo completo: cargar día → tomar turno → marcar presente → cancelar
4. El encargado ve el dropdown de operadores y los links de administración
5. El operador NO ve los links de administración
6. La navegación semana/mes muestra días especiales con overlay correcto

---

## Archivos que se modifican

| Archivo | Tipo de cambio |
|---|---|
| `public/panel/agenda.html` | Reescritura completa del HTML estático + CSS + funciones de render |
| `public/assets/design-tokens.css` | Solo lectura — no se modifica |

Los demás HTML del panel (dashboard, auditoria, etc.) no se tocan en esta iteración.
