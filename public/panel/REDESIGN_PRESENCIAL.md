# Plan de rediseño — presencial.html
# Referencia: design_handoff_sistema_turnos/README.md § "Presencial — Drawer"
# Restricciones: Vanilla JS · no tocar lógica JS · solo vars de design-tokens.css

---

## 1. Inventario de IDs obligatorios

Estos IDs son leídos o escritos por el JS y deben sobrevivir intactos.

### Sidebar (copiados de agenda.html — el init() los inicializa)
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `sidebar-avatar` | `init()` | rellena iniciales + color de rol |
| `nav-nombre` | `init()` | inyecta `nombre + rolBadgeHTML()` |
| `nav-auditoria` | `init()` | muestra/oculta según rol |
| `nav-dashboard` | `init()` | muestra/oculta según rol |
| `nav-usuarios` | `init()` | muestra/oculta según rol |
| `nav-servicios` | `init()` | muestra/oculta según rol |
| `label-reportes` | `init()` | muestra label de sección según rol |
| `label-admin` | `init()` | muestra label de sección según rol |

### Stepper
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `stepper` | `confirmarTurno()`, `reiniciar()` | `display:none/flex` |
| `step-ind-1` | `actualizarStepper()` | agrega/quita `.activo`, `.completo` |
| `step-ind-2` | `actualizarStepper()` | agrega/quita `.activo`, `.completo` |
| `linea-1` | `actualizarStepper()` | agrega/quita `.completa` |

### Paso 1
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `paso-1` | `mostrarPaso()` | `display:none/block` |
| `error-1` | `mostrarError()` | `.textContent` + toggle `.visible` |
| `dni` | `buscarVecino()`, `irPaso2()`, `reiniciar()` | `.value` |
| `btn-buscar` | `buscarVecino()` | `.disabled`, `.textContent` |
| `resultado-busqueda` | `buscarVecino()`, `reiniciar()` | `display:none/block` |
| `chip-vecino` | `buscarVecino()` | `.className`, `.textContent` |
| `nombre` | `buscarVecino()`, `irPaso2()`, `reiniciar()` | `.value`, `.readOnly` |
| `hint-nombre` | `buscarVecino()` | `.textContent` |
| `telefono` | `buscarVecino()`, `irPaso2()`, `reiniciar()` | `.value` |
| `btn-siguiente-1` | `buscarVecino()`, `reiniciar()`, `init()` | `.disabled` |

### Paso 2
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `paso-2` | `mostrarPaso()` | `display:none/block` |
| `error-2` | `mostrarError()` | `.textContent` + toggle `.visible` |
| `selector-areas-presencial` | `inicializarChipsPresencial()` | agrega `.visible` |
| `chips-areas-presencial` | `inicializarChipsPresencial()`, `filtrarServiciosPorArea()` | inserta `<span class="area-chip">` dinámicamente |
| `servicio` | `actualizarSlots()`, `filtrarServiciosPorArea()`, `irPaso2()`, `reiniciar()` | `.value`, `.innerHTML` |
| `fecha` | `actualizarSlots()`, `irPaso2()`, `reiniciar()`, `init()` | `.value`, `.min` |
| `slots-area` | `actualizarSlots()`, `reiniciar()` | `.innerHTML` — inyecta clases dinámicas (ver §3) |
| `btn-confirmar` | `actualizarSlots()`, `seleccionarSlot()`, `confirmarTurno()`, `irPaso2()`, `init()` | `.disabled`, `.textContent` |

### Pantalla éxito
| ID | Quién lo usa | Qué hace |
|---|---|---|
| `paso-exito` | `mostrarPaso()` | `display:none/block` |
| `ex-vecino` | `confirmarTurno()` | `.textContent` |
| `ex-dni` | `confirmarTurno()` | `.textContent` |
| `ex-tramite` | `confirmarTurno()` | `.textContent` |
| `ex-fecha` | `confirmarTurno()` | `.textContent` |
| `ex-hora` | `confirmarTurno()` | `.textContent` |
| `ex-operador` | (solo HTML estático) | texto fijo |
| `ex-mensaje` | `confirmarTurno()` | `.textContent`, `display:block` |

---

## 2. Clases CSS generadas dinámicamente por JS

Estas clases son inyectadas vía `.innerHTML` — deben existir en el CSS nuevo.

### Por `inicializarChipsPresencial()`:
- `.area-chip` — chip de área (base)
- `.area-chip.activo` — chip seleccionado

### Por `actualizarSlots()`:
- `.slots-placeholder` — texto gris inicial y de error leve
- `.slots-cargando` — texto gris "Cargando..."
- `.slots-vacio` — box amber "No hay horarios"
- `.slots-titulo` — label "Seleccioná un horario disponible:"
- `.slots-grid` — grilla 4 columnas de slots
- `.slot-btn` — botón de horario individual
- `.slot-btn.seleccionado` — horario elegido (toggle por `seleccionarSlot()`)

### Por `buscarVecino()` en `#chip-vecino`:
- `.vecino-chip.chip-existente` — vecino ya registrado
- `.vecino-chip.chip-nuevo` — vecino nuevo

### Por `actualizarStepper()`:
- `.step.activo` — paso actual
- `.step.completo` — paso ya completado
- `.step-linea.completa` — línea entre pasos completada

### Por `mostrarError()`:
- `.alerta.visible` — toggle `display: block` de la alerta

---

## 3. Funciones JS: presentación vs lógica

### Lógica de negocio — NO MODIFICAR
| Función | Por qué no se toca |
|---|---|
| `getToken()`, `getUsuario()`, `apiFetch()`, `cerrarSesion()` | Auth |
| `buscarVecino()` | fetch + validación |
| `actualizarSlots()` | fetch + anti-abuso |
| `confirmarTurno()` | fetch POST |
| `irPaso1()`, `irPaso2()` | validación de campos |
| `seleccionarSlot()` | estado de selección |
| `reiniciar()` | reset completo del formulario |
| `filtrarServiciosPorArea()` | lógica de filtros |
| `inicializarChipsPresencial()` | construcción de chips con handlers |
| `formatearFechaBonita()` | formato de fecha |
| `init()` | inicialización async |

### Presentación — SE PUEDEN REESCRIBIR (solo el HTML que generan)
| Función | Qué se puede cambiar |
|---|---|
| `rolBadgeHTML()` | Reemplaza estilos inline hardcodeados por clases del design system (`.role-badge .role-encargado`, etc.). La firma y el `return` de HTML no cambian. |
| `actualizarStepper()` | No genera HTML — manipula clases CSS. No hay nada que reescribir, solo asegurarse de que las clases CSS nuevas respondan a `.activo` y `.completo`. |
| `mostrarError()` | Idéntica — funciona por toggle de `.visible`. |

---

## 4. Mapeo de colores hardcodeados → tokens

| Contexto | Valor actual | Token equivalente |
|---|---|---|
| Body bg | `#f1f5f9` | `var(--bg-0)` |
| Body color | `#1e293b` | `var(--text-1)` (ya en design-tokens base) |
| Navbar bg | `#1A3C4B` | → se elimina (reemplazada por sidebar) |
| Card bg | `white` | `var(--bg-3)` |
| Card shadow | `rgba(0,0,0,.08)` | `0 0 0 1px var(--border)` |
| Stepper círculo inactivo border | `#d1d5db` | `var(--border)` |
| Stepper círculo inactivo bg | `white` | `var(--bg-4)` |
| Stepper círculo inactivo color | `#94a3b8` | `var(--text-3)` |
| Stepper activo (border/bg) | `#1A3C4B` | `var(--teal)` |
| Stepper activo color | `white` | `var(--bg-0)` |
| Stepper completo (border/bg) | `#16a34a` | `var(--teal)` |
| Stepper label inactivo | `#94a3b8` | `var(--text-3)` |
| Stepper label activo | `#1A3C4B` | `var(--teal)` |
| Stepper label completo | `#16a34a` | `var(--teal)` |
| Stepper línea | `#e2e8f0` | `var(--border)` |
| Stepper línea completa | `#16a34a` | `var(--teal)` |
| Título de paso (Trebuchet MS) | `#1A3C4B` | `var(--text-1)`, font: `var(--font-ui)` |
| Labels | `#374151` | `var(--text-2)` |
| Input border | `#d1d5db` | `var(--border)` |
| Input bg | `white` | `var(--bg-4)` |
| Input focus border | `#1A3C4B` | `var(--border-hi)` |
| Input focus shadow | `rgba(26,60,75,.12)` | `var(--teal-dim)` |
| Input disabled bg | `#f8fafc` | `var(--bg-3)` |
| Input disabled color | `#475569` | `var(--text-3)` |
| Hint | `#94a3b8` | `var(--text-3)` |
| Btn-buscar bg | `#1A3C4B` | `var(--teal)` |
| Btn-buscar color | `white` | `var(--bg-0)` |
| chip-existente bg | `#dcfce7` | `rgba(45,212,160,0.15)` |
| chip-existente color | `#15803d` | `var(--teal)` |
| chip-existente border | _(ninguno)_ | `1px solid var(--teal-mid)` |
| chip-nuevo bg | `#dbeafe` | `var(--blue-dim)` |
| chip-nuevo color | `#1e40af` | `var(--blue)` |
| chip-nuevo border | _(ninguno)_ | `1px solid var(--blue-mid)` |
| `.btn-primary` bg | `#1A3C4B` | `var(--teal)` — usar clase `.btn-primary` de tokens |
| `.btn-ghost` bg | `white` | transparente — usar clase `.btn-secondary` de tokens |
| Slot btn border | `#e2e8f0` | `var(--border-hi)` |
| Slot btn hover color | `#1A3C4B` | `var(--teal)` |
| Slot btn seleccionado bg | `#FEEEC2` | `var(--teal-dim)` |
| Slot btn seleccionado border | `#1A3C4B` | `var(--teal)` |
| `.slots-placeholder/cargando` | `#94a3b8` | `var(--text-3)` |
| `.slots-vacio` bg | `#fef3c7` | `var(--amber-dim)` |
| `.slots-vacio` border | `#fde68a` | `var(--amber-mid)` |
| `.slots-vacio` color | `#92400e` | `var(--amber)` |
| `.alerta-error` bg | `#fef2f2` | `var(--red-dim)` |
| `.alerta-error` border | `#fecaca` | `var(--red-mid)` |
| `.alerta-error` color | `#991b1b` | `var(--red)` |
| `.alerta-ok` bg | `#f0fdf4` | `var(--teal-dim)` |
| `.alerta-ok` border | `#bbf7d0` | `var(--teal-mid)` |
| `.alerta-ok` color | `#166534` | `var(--teal)` |
| Área chip border | `#e2e8f0` | `var(--border)` |
| Área chip color | `#475569` | `var(--text-2)` |
| Área chip hover | `#1A3C4B` | `var(--border-hi)` / `var(--text-1)` |
| Área chip activo bg | `#1A3C4B` | `var(--teal-dim)` |
| Área chip activo color | `white` | `var(--teal)` |
| Área chip activo border | `#1A3C4B` | `var(--teal-mid)` |
| `.area-selector-titulo` | `#64748b` | `var(--text-3)` |
| Éxito h2 color | `#15803d` | `var(--teal)` |
| SVG circle fill | `#1A3C4B` | `var(--teal)` |
| `.exito-detalle` bg | `#f8fafc` | `var(--bg-2)` |
| `.exito-detalle p` color | `#475569` | `var(--text-2)` |
| `.exito-detalle p span` color | `#1e293b` | `var(--text-1)` |
| `.exito-mensaje` bg | `#eff6ff` | `var(--blue-dim)` |
| `.exito-mensaje` border | `#bfdbfe` | `var(--blue-mid)` |
| `.exito-mensaje` color | `#1e40af` | `var(--blue)` |
| Link "Ver agenda" color | `#1A3C4B` (inline) | `var(--teal)` |
| Inline `color:#64748b` (subtexto éxito) | hardcoded | `var(--text-2)` |
| Inline `color:#dc2626` (error en slots JS) | hardcoded en JS | DEJAR — está en el bloque `<script>` |

---

## 5. Qué cubre design-tokens.css (no hay que redefinir)

| Uso | Clase de tokens |
|---|---|
| Botón primario (confirmar, siguiente, buscar) | `.btn.btn-primary` |
| Botón secundario (volver) | `.btn.btn-secondary` |
| Chips de área | `.filter-chip` / `.filter-chip.active` — PERO el JS crea elementos con `.area-chip`, así que hay que mapear `.area-chip` → mismos estilos que `.filter-chip`, NO cambiar el JS |
| Slots de horario | `.slot-horario` / `.slot-horario.selected` — mismo problema: JS usa `.slot-btn`, hay que mapearlo |
| Reset global, font, bg/color del body | ya en `html, body { ... }` de design-tokens.css |
| Badge de rol | `.role-badge .role-encargado/.role-operador/etc.` — reescribir `rolBadgeHTML()` para usarlas |

---

## 6. Nueva estructura HTML objetivo

```
<body>  ← design-tokens.css ya pone bg-0, font-ui, text-1

  <div class="app-shell">          ← flex, height:100vh (igual que agenda)

    <aside class="sidebar">        ← copiado íntegro de agenda.html
      … sidebar-header, sidebar-user-card, sidebar-nav, sidebar-footer
      · Cambiar nav-item activo a "Presencial"
      · NO incluir sidebar-minical (no hay función renderizarMiniCal en presencial)
    </aside>

    <main class="main-content">   ← flex:1, overflow-y:auto, bg: var(--bg-2)
      <div class="page-inner">    ← max-width:600px, margin:auto, padding:2rem 1.5rem

        <div class="page-header"> ← título de página + subtítulo teal
          <p class="page-supertitle">Carga presencial</p>
          <h1 class="page-title">Nueva reserva</h1>
        </div>

        <div class="card">        ← bg-3, border, radius-lg, padding

          <!-- Stepper -->
          <div class="stepper" id="stepper">
            <div class="step" id="step-ind-1">
              <div class="step-circulo">1</div>
              <div class="step-label">Vecino</div>
            </div>
            <div class="step-linea" id="linea-1"></div>
            <div class="step" id="step-ind-2">
              <div class="step-circulo">2</div>
              <div class="step-label">Turno</div>
            </div>
          </div>

          <!-- Paso 1 (id="paso-1") -->
          <!-- Paso 2 (id="paso-2", display:none) -->
          <!-- Éxito (id="paso-exito", display:none) -->

        </div><!-- .card -->
      </div><!-- .page-inner -->
    </main>

  </div><!-- .app-shell -->

  <script> … idéntico al actual … </script>

</body>
```

---

## 7. CSS nuevo para el `<style>` interno

Solo lo que design-tokens.css no cubre. Usar únicamente vars.

```css
/* Layout */
.app-shell      { display: flex; height: 100vh; overflow: hidden; }
.main-content   { flex: 1; overflow-y: auto; background: var(--bg-2); }
.page-inner     { max-width: 600px; margin: 0 auto; padding: 2rem 1.5rem; }

/* Card contenedor del formulario */
.card {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 2rem;
}

/* Header de página */
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

/* Stepper */
.stepper       { display: flex; align-items: center; margin-bottom: 2rem; }
.step          { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; flex: 1; position: relative; }
.step-circulo  {
  width: 28px; height: 28px; border-radius: 50%;
  border: 1.5px solid var(--border);
  background: var(--bg-4); color: var(--text-3);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: var(--text-sm); z-index: 1;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}
.step.activo  .step-circulo { border-color: var(--teal); background: var(--teal); color: var(--bg-0); }
.step.completo .step-circulo { border-color: var(--teal); background: var(--teal); color: var(--bg-0); }
.step-label    { font-size: var(--text-xs); color: var(--text-3); text-align: center; }
.step.activo  .step-label { color: var(--teal); font-weight: 600; }
.step.completo .step-label { color: var(--teal); }
.step-linea    { flex: 1; height: 1px; background: var(--border); margin-top: -18px; z-index: 0; }
.step-linea.completa { background: var(--teal); }

/* Títulos de paso */
.paso-titulo {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 1.25rem;
}

/* Forms */
.form-grupo  { margin-bottom: 1.1rem; }
.form-fila   { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: 0.4rem;
}
input, select {
  width: 100%;
  background: var(--bg-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-1);
  font-size: var(--text-base);
  padding: 0.6rem 0.75rem;
  transition: var(--transition-fast);
}
input::placeholder { color: var(--text-3); }
input:focus, select:focus {
  border-color: var(--border-hi);
  box-shadow: 0 0 0 3px var(--teal-dim);
}
input:disabled, input[readonly] {
  background: var(--bg-3);
  color: var(--text-3);
  cursor: default;
}
.hint { font-size: var(--text-xs); color: var(--text-3); margin-top: 0.3rem; }

/* Fila DNI */
.dni-row        { display: flex; gap: 0.5rem; }
.dni-row input  { flex: 1; }
.btn-buscar {          /* se usa también el .btn base de tokens */
  flex-shrink: 0;
  white-space: nowrap;
}

/* Chip de estado del vecino */
.vecino-chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.3rem 0.85rem; border-radius: 99px;
  font-size: var(--text-sm); font-weight: 600;
  margin-bottom: 1.1rem;
  border: 1px solid;
}
.chip-existente { background: rgba(45,212,160,0.15); color: var(--teal);  border-color: var(--teal-mid); }
.chip-nuevo     { background: var(--blue-dim);       color: var(--blue);  border-color: var(--blue-mid); }

/* Botones de navegación */
.botones-nav { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
.botones-nav .btn-primary { flex: 1; }

/* Área de slots */
.slots-area    { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
.slots-titulo  { font-size: var(--text-sm); color: var(--text-2); margin-bottom: 0.75rem; }
.slots-grid    { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }

/* slot-btn: mismo estilo que .slot-horario de design-tokens.css pero con nombre que usa el JS */
.slot-btn {
  display: flex; align-items: center; justify-content: center;
  height: 38px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-hi);
  font-family: var(--font-mono);
  font-size: 13.5px;
  cursor: pointer;
  transition: var(--transition-fast);
  color: var(--text-1);
  background: transparent;
}
.slot-btn:hover      { border-color: var(--teal); background: var(--teal-dim); color: var(--teal); }
.slot-btn.seleccionado { border-color: var(--teal); background: var(--teal-dim); color: var(--teal); font-weight: 600; }

/* Estados de slots */
.slots-placeholder, .slots-cargando {
  font-size: var(--text-sm); color: var(--text-3); font-style: italic;
}
.slots-vacio {
  background: var(--amber-dim);
  border: 1px solid var(--amber-mid);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  font-size: var(--text-sm);
  color: var(--amber);
}

/* Alertas */
.alerta { padding: 0.7rem 0.9rem; border-radius: var(--radius-md); font-size: var(--text-sm); margin-bottom: 1.1rem; display: none; }
.alerta.visible { display: block; }
.alerta-error { background: var(--red-dim);  border: 1px solid var(--red-mid);  color: var(--red);  }
.alerta-ok    { background: var(--teal-dim); border: 1px solid var(--teal-mid); color: var(--teal); }

/* Área selector de chips (label + chips) */
.area-selector { margin-bottom: 0.85rem; display: none; }
.area-selector.visible { display: block; }
.area-selector-titulo {
  font-size: var(--text-xs); font-weight: 700;
  color: var(--text-3);
  text-transform: uppercase; letter-spacing: 0.07em;
  margin-bottom: 0.4rem;
}
.area-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }

/* area-chip: mismo estilo que .filter-chip de design-tokens, pero JS usa area-chip */
.area-chip {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 20px;
  border: 1px solid var(--border);
  font-size: var(--text-sm); font-weight: 500;
  cursor: pointer; color: var(--text-2);
  background: transparent;
  transition: var(--transition-fast);
  user-select: none;
}
.area-chip:hover  { background: var(--bg-4); border-color: var(--border-hi); color: var(--text-1); }
.area-chip.activo { background: var(--teal-dim); border-color: var(--teal-mid); color: var(--teal); font-weight: 600; }

/* Pantalla de éxito */
.exito          { text-align: center; padding: 1rem 0; }
.exito-icono    { margin-bottom: 0.75rem; display: flex; justify-content: center; }
.exito h2       { font-size: var(--text-xl); font-weight: 800; color: var(--teal); margin-bottom: 0.5rem; }
.exito-subtexto { font-size: var(--text-sm); color: var(--text-2); margin-bottom: 1rem; }
.exito-detalle  {
  background: var(--bg-2); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 1rem; margin: 1rem 0; text-align: left;
}
.exito-detalle p      { font-size: var(--text-sm); color: var(--text-2); margin-bottom: 0.3rem; }
.exito-detalle p span { font-weight: 600; color: var(--text-1); }
.exito-mensaje {
  background: var(--blue-dim); border: 1px solid var(--blue-mid);
  border-radius: var(--radius-md); padding: 0.9rem 1rem;
  font-size: var(--text-sm); color: var(--blue);
  margin-top: 1rem; line-height: 1.5;
}
.exito-link {
  display: block; text-align: center;
  margin-top: 0.75rem; font-size: var(--text-sm);
  color: var(--teal); text-decoration: none;
}
.exito-link:hover { text-decoration: underline; }

/* Sidebar — copiado/adaptado de agenda.html (mismas vars, sin redefinir) */
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

Solo se modifica `rolBadgeHTML()` — es una función de presentación que hoy usa estilos inline hardcodeados. Se reescribe para usar las clases del design system:

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

> **Nota:** `.role-badge`, `.role-encargado`, `.role-operador`, `.role-sistemas`, `.role-directivo` ya están definidos en `design-tokens.css`. La lógica de la función (qué rol mapea a qué label) NO cambia.

---

## 9. Inline styles a eliminar del HTML

Estos estilos hardcodeados están en el HTML estático y deben moverse al CSS:

| Elemento | Style inline actual | Solución |
|---|---|---|
| `<span style="color:#dc2626">*</span>` en label teléfono | color rojo hardcoded | agregar clase `.required-mark` con `color: var(--red)` |
| `<p style="font-size:0.875rem;color:#64748b;...">` en éxito | hardcoded | agregar clase `.exito-subtexto` |
| `<a style="...;color:#1A3C4B;...">` link "Ver agenda" | hardcoded | agregar clase `.exito-link` |
| `<button ... style="margin-top:1.5rem">` en éxito | margin inline | agregar clase `.exito-btn-nuevo` con `margin-top: 1.5rem` |

---

## 10. Orden de implementación (pasos con checkpoint)

### Paso 1 — Layout shell y sidebar
- Reemplazar `<nav class="navbar">` por sidebar de agenda.html
- Cambiar `.nav-item.active` a "Presencial"
- Wrap del contenido en `.app-shell > .main-content > .page-inner`
- CSS: `.app-shell`, `.main-content`, `.page-inner`, sidebar completo
- CSS minical: `.minical`, `.minical-header`, `.minical-grid`, `.minical-dow`, `.minical-cell` y variantes (copiado exacto de agenda.html)
- Copiar función `renderizarMiniCal()` del `<script>` de agenda.html al `<script>` de presencial.html (va antes del `init()`)
- Al final del `init()` de presencial.html agregar la llamada: `renderizarMiniCal();`
- **Verificar:** sidebar visible, mini-calendario renderiza con el mes actual, nav-nombre se llena, links de rol aparecen según usuario

### Paso 2 — Card, header de página, stepper
- CSS: `.card`, `.page-header`, `.page-supertitle`, `.page-title`
- CSS: stepper con todos sus estados (`.activo`, `.completo`, `.step-linea.completa`)
- **Verificar:** stepper avanza al pasar de paso 1 → 2, se muestra teal al completar

### Paso 3 — Formulario paso 1
- CSS: inputs, labels, hints, `.dni-row`, `.btn-buscar` (usa `.btn.btn-primary`)
- CSS: `.vecino-chip`, `.chip-existente`, `.chip-nuevo`
- CSS: `.alerta`, `.alerta-error`, `.alerta.visible`
- Eliminar inline styles del label de teléfono
- **Verificar:** buscarVecino() muestra chip correcto; error de DNI inválido aparece en rojo

### Paso 4 — Formulario paso 2 (servicio, fecha, slots)
- CSS: `.area-selector`, `.area-chip`, `.area-chip.activo`
- CSS: select, input[type=date] (mismos que paso 3)
- CSS: `.slots-area`, `.slot-btn`, `.slot-btn.seleccionado`, estados de slots
- CSS: `.botones-nav`
- **Verificar:** slots se cargan y se seleccionan con highlight teal; chips de área filtran

### Paso 5 — Pantalla de éxito
- CSS: `.exito`, `.exito-icono`, `.exito h2`, `.exito-subtexto`, `.exito-detalle`
- CSS: `.exito-mensaje`, `.exito-link`, `.exito-btn-nuevo`
- Cambiar SVG `fill="#1A3C4B"` → `fill="currentColor"` + `color: var(--teal)` en padre
- Eliminar inline styles del HTML de éxito
- **Verificar:** pantalla de éxito renderiza con paleta dark, link "Ver agenda" en teal

### Paso 6 — `rolBadgeHTML()` y limpieza final
- Reescribir `rolBadgeHTML()` para usar `.role-badge .role-XXX`
- Grep hex hardcodeados: `grep -n "#[0-9a-fA-F]\{3,6\}" presencial.html` → 0 resultados
- **Verificar:** badge de rol en sidebar usa colores del design system

### Commit por paso
Cada paso hace un commit antes de avanzar al siguiente:
`feat(panel): presencial paso N — descripción`
