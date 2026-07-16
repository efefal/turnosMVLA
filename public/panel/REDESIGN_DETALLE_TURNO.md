# Plan — Vista de detalle de turno (modal)
# Referencia principal: modal cancelar de agenda.html (mismo archivo, mismo patrón)
# Referencia de modificador de ancho: usuarios.html (.modal-caja-sm)
# Restricciones: Vanilla JS · sin frameworks · solo vars de design-tokens.css

---

## Contexto

Vista de detalle de un turno: datos del turno, datos de contacto del vecino
(teléfono — no hay columna de email en `vecinos`, confirmado con `DESCRIBE`
contra la base viva) e historial de turnos pasados del mismo vecino. Sin
botones de envío en esta primera versión — el teléfono se muestra para
copiar manualmente.

Se abre desde dos puntos de `agenda.html`:
1. Click en una card de turno de la **vista semana** (ya existe el hook:
   `abrirDetalleTurno(id)`, hoy solo navega a vista día — se reemplaza).
2. Selección de un resultado del **buscador global** — además de lo que ya
   hace hoy (`seleccionarResultadoBusqueda`: cambiar fecha, cambiar a vista
   día, scroll+resaltar la card), se abre el modal encima. Al cerrar el
   modal, el operador queda parado en el día correcto.

Mecanismo: **modal**, reusando `.modal-fondo`/`.modal-caja` (ya en uso en
agenda.html para "Cancelar turno"), no drawer — `.drawer`/`.drawer-overlay`
existe solo como CSS sin ningún HTML que lo use hoy (confirmado en el
análisis).

### Decisión abierta — vista día

La vista día de `agenda.html` (`cargarDia()` / la función que arma
`cardsHTML` con `agruparPorFila`, línea ~1308) **no tiene hoy ningún
`onclick` en la card de turno** — solo botones de acción inline (Tomar/
Cancelar/Presente/Ausente/Liberar). Es la vista más usada del panel y hoy
no tiene forma de abrir el detalle.

Solo la **vista semana** tiene el hook `abrirDetalleTurno(id)` en la card
completa (línea 1717).

**Confirmado: se incluye en esta misma pasada** (fusionado con el wiring
de vista semana + buscador global, ver Paso 3 más abajo). Se agrega el
mismo `onclick="abrirDetalleTurno(${t.id})"` a la card de la vista día,
con `event.stopPropagation()` en cada botón de acción inline para que
Tomar/Cancelar/etc. no disparen también la apertura del modal. La vista
mes no se toca: ahí no hay cards individuales por turno, solo el conteo
del día.

---

## 1. Inventario de IDs obligatorios

### Modal de detalle (nuevo, en agenda.html)

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `modal-detalle-fondo` | `abrirDetalleTurno()`, `cerrarDetalleTurno()` | toggle clase `.abierto` |
| `detalle-cargando` | `abrirDetalleTurno()` | se muestra mientras llega la respuesta del fetch |
| `detalle-error` | `abrirDetalleTurno()` | alerta de error si falla el fetch |
| `detalle-contenido` | `renderizarDetalleTurno()` | `.innerHTML` con el HTML armado (turno + vecino + historial) |

No hace falta más granularidad de IDs adentro de `detalle-contenido` —
igual que `modal-info` en el modal de cancelar, es un único bloque que se
regenera entero en cada apertura (no hay campos editables que necesiten
`.value` individual).

### Sin cambios de ID en elementos existentes

`abrirDetalleTurno(id)` y `seleccionarResultadoBusqueda(t)` **mantienen su
firma actual** — se les cambia el cuerpo, no la forma en que se las llama
desde las cards ni desde el buscador. Esto evita tocar los `onclick`
inline ya presentes en `renderizarSemana()` (línea 1717).

---

## 2. Endpoint nuevo

### GET /panel/turno/:id/completo

Patrón de auth: ninguno especial — hereda `router.use(verificarJWT)` como
todos los endpoints de `panel.js`. Confirmado en el análisis: acceso
abierto a **todos los roles autenticados** (mismo criterio que
`GET /panel/vecino/:dni`), incluido el historial completo.

Sí se respeta el filtro de área existente: un operador/encargado solo debe
poder ver el detalle de un turno de una de sus áreas — incluso siendo de
"lectura abierta por rol", no debe ser una fuga entre áreas. Se usa
`tieneAccesoAlArea()` (helper ya existente, línea 62) contra el
`area_id` del turno pedido.

```javascript
// GET /panel/turno/:id/completo
// Devuelve el turno con todos sus datos relacionados (vecino, servicio,
// operador, área) más el historial de turnos pasados del mismo vecino.
// Pensado para la vista de detalle (modal) de agenda.html.
router.get('/turno/:id/completo', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'ID de turno inválido.' });
  }

  try {
    const [turnoRows] = await pool.query(`
      SELECT
        t.id, t.fecha, t.hora_inicio, t.hora_fin, t.estado,
        t.canal_origen, t.motivo_cancelacion, t.created_at,
        v.id       AS vecino_id,
        v.dni      AS vecino_dni,
        v.nombre   AS vecino_nombre,
        v.telefono AS vecino_telefono,
        s.id       AS servicio_id,
        s.nombre   AS servicio_nombre,
        t.operador_id,
        u.nombre   AS operador_nombre,
        a.id       AS area_id,
        a.nombre   AS area_nombre
      FROM turnos t
      JOIN vecinos   v ON t.vecino_id   = v.id
      JOIN servicios s ON t.servicio_id = s.id
      LEFT JOIN usuarios u ON t.operador_id = u.id
      JOIN areas     a ON s.area_id     = a.id
      WHERE t.id = ?
    `, [id]);

    if (turnoRows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado.' });
    }
    const turno = turnoRows[0];

    // Mismo criterio de acceso por área que /agenda y /agenda/rango —
    // ver acá no depende del rol (todos los roles ven historial), pero
    // sí depende del área: un operador de Tránsito no debe poder abrir
    // el detalle de un turno de Tribunal de Faltas escribiendo el ID a mano.
    if (!tieneAccesoAlArea(req, turno.area_id)) {
      return res.status(403).json({ error: 'No tenés acceso a esta área.' });
    }

    // Historial: turnos pasados del mismo vecino, excluyendo el turno actual.
    // idx_turnos_vecino_servicio ya cubre vecino_id — consulta barata.
    const [historial] = await pool.query(`
      SELECT
        t.id, t.fecha, t.hora_inicio, t.estado,
        s.nombre AS servicio_nombre
      FROM turnos t
      JOIN servicios s ON t.servicio_id = s.id
      WHERE t.vecino_id = ? AND t.id != ?
      ORDER BY t.fecha DESC, t.hora_inicio DESC
      LIMIT 10
    `, [turno.vecino_id, id]);

    res.json({ turno, historial });
  } catch (err) {
    logger.error('[panel] Error al obtener detalle de turno:', err);
    res.status(500).json({ error: 'No se pudo obtener el detalle del turno.' });
  }
});
```

**Shape de respuesta:**

```jsonc
{
  "turno": {
    "id": 431,
    "fecha": "2026-07-18",
    "hora_inicio": "09:30:00",
    "hora_fin": "09:50:00",
    "estado": "agendado",
    "canal_origen": "whatsapp",
    "motivo_cancelacion": null,
    "created_at": "2026-07-10 14:02:11",
    "vecino_id": 88,
    "vecino_dni": "30123456",
    "vecino_nombre": "Ana Gómez",
    "vecino_telefono": "2944123456",   // puede ser "" si es NULL en la base
    "servicio_id": 3,
    "servicio_nombre": "Renovación de Licencia",
    "operador_id": 5,
    "operador_nombre": "Juan Pérez",   // null si no fue tomado
    "area_id": 1,
    "area_nombre": "Licencias de Conducir"
  },
  "historial": [
    { "id": 402, "fecha": "2026-05-02", "hora_inicio": "10:00:00", "estado": "atendido", "servicio_nombre": "Nueva Licencia" }
    // hasta 10 filas, orden más reciente primero
  ]
}
```

**Por qué `LIMIT 10` en el historial:** el objetivo declarado es "contexto
para el operador", no un reporte completo — 10 alcanza para eso sin
convertir el modal en una tabla larga. Si en el uso real se ve corto, es
un cambio de una línea (`LIMIT 10` → otro número), no de arquitectura.

**Sin auditoría:** es un GET de solo lectura. Ningún otro endpoint `GET`
de `panel.js` llama a `auditar()` — se sigue ese mismo criterio.

**Ubicación en el archivo:** junto a los otros endpoints de turno
(`tomarTurno`, `liberarTurno`, cancelar — sección "TURNOS" del archivo),
antes de la sección de disponibilidad/presencial.

---

## 3. HTML objetivo del modal

Estructura en 3 bloques dentro de `detalle-contenido`, sin tabs ni
acordeón — todo visible de una:

```
┌──────────────────────────────────────────────┐
│  [Servicio]                          [Estado] │  ← título + badge estado
│  Turno #431 · 18/07/2026 · 09:30 hs           │
├──────────────────────────────────────────────┤
│  VECINO                                       │
│  Ana Gómez — DNI 30123456                     │
│  📞 2944123456  [Copiar]                      │
│  (sin teléfono → "Sin teléfono registrado")   │
├──────────────────────────────────────────────┤
│  TURNO                                        │
│  Área: Licencias de Conducir                  │
│  Operador: Juan Pérez  (o "Sin asignar")      │
│  Canal: WhatsApp                              │
│  Cargado: 10/07/2026 14:02                    │
│  Motivo cancelación: … (solo si aplica)       │
├──────────────────────────────────────────────┤
│  [Acciones de comunicación — placeholder]     │  ← ver §6
├──────────────────────────────────────────────┤
│  HISTORIAL DEL VECINO (últimos 10)            │
│  18/05/2026  Nueva Licencia        Atendido   │
│  02/03/2026  Renovación...         Ausente    │
│  (sin historial → "Sin turnos anteriores.")   │
└──────────────────────────────────────────────┘
```

Historial como **lista simple** (`<div>` por fila, no `<table>`): son 3
datos por fila (fecha, servicio, estado) y el modal ya es angosto — una
tabla con `<th>` agrega peso visual sin aportar nada que una lista con
buen espaciado no dé. Mismo criterio que usa `search-global-resultados`
para listar resultados de búsqueda (`.search-global-item`), que ya es
"lista de turnos con 3 datos por fila" — se puede calcar esa estructura
con nombres de clase propios.

### Marcado

```html
<!-- Modal de detalle de turno — fuera del app-shell, mismo criterio que
     el modal de cancelar (evita problemas de z-index/stacking context) -->
<div class="modal-fondo" id="modal-detalle-fondo">
  <div class="modal-caja modal-caja-detalle">

    <div id="detalle-cargando" class="cargando">Cargando...</div>
    <div class="alerta alerta-error" id="detalle-error"></div>
    <div id="detalle-contenido"></div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarDetalleTurno()">Cerrar</button>
    </div>
  </div>
</div>
```

`detalle-contenido` se llena por JS (`renderizarDetalleTurno(data)`) con
un template string, mismo estilo que el resto del archivo.

### Copiar teléfono

Botón "Copiar" al lado del teléfono usando `navigator.clipboard.writeText()`
— no es un "botón de envío" (no contacta a nadie, no sale nada del
navegador), es una utilidad de UI que ya encaja en "mostrar para copiar
manualmente" del alcance. Si `vecino_telefono` es `""` (NULL en la base),
no se muestra el botón, solo el texto "Sin teléfono registrado".

---

## 4. Cambio en `abrirDetalleTurno()` (agenda.html)

Reemplaza el cuerpo actual (que solo navegaba a vista día). Nueva versión:

```javascript
// Abre el modal de detalle de un turno. Reemplaza la navegación simple
// que tenía antes — el detalle completo ahora se ve acá, sin salir de
// la vista en la que está parado el operador.
async function abrirDetalleTurno(id) {
  document.getElementById('modal-detalle-fondo').classList.add('abierto');
  document.getElementById('detalle-cargando').style.display = 'block';
  document.getElementById('detalle-error').classList.remove('visible');
  document.getElementById('detalle-contenido').innerHTML = '';

  const res = await apiFetch(`/panel/turno/${id}/completo`);
  document.getElementById('detalle-cargando').style.display = 'none';

  if (!res || !res.ok) {
    document.getElementById('detalle-error').textContent = 'No se pudo cargar el detalle del turno.';
    document.getElementById('detalle-error').classList.add('visible');
    return;
  }

  const data = await res.json();
  renderizarDetalleTurno(data);
}

function cerrarDetalleTurno() {
  document.getElementById('modal-detalle-fondo').classList.remove('abierto');
}

function renderizarDetalleTurno(data) {
  // arma el template string descripto en §3 a partir de data.turno / data.historial
  document.getElementById('detalle-contenido').innerHTML = /* ... */;
}
```

Ya no cambia `fechaActual` ni la vista — eso solo pasa hoy desde el click
en la card de semana porque el usuario ya está viendo esa fecha (no hace
falta navegar a ningún lado, el modal se abre encima). El caso del
buscador global sí sigue navegando primero (ver §5).

---

## 5. Cambio en `seleccionarResultadoBusqueda()` (agenda.html)

Decisión ya tomada: navega a la vista día **y** abre el modal encima.

```javascript
async function seleccionarResultadoBusqueda(t) {
  cerrarBuscadorGlobal();
  fechaActual = typeof t.fecha === 'string' ? t.fecha.substring(0, 10) : t.fecha;
  document.getElementById('fecha-input').value = fechaActual;
  actualizarLabelDia();
  await cambiarVista('dia');
  resaltarTurnoEncontrado(t.id);
  await abrirDetalleTurno(t.id);   // NUEVO — modal encima de la vista ya resaltada
}
```

Al cerrar el modal (`cerrarDetalleTurno()`), el operador queda en la vista
día correcta con la card ya resaltada de fondo — cumple lo pedido
("listo para operar sobre él sin tener que volver a buscar").

---

## 6. CSS necesario

Mínimo, local a `agenda.html` (mismo criterio que el resto del panel: cero
hex, solo tokens). Se agrega al `<style>` ya existente, junto a las reglas
de `.modal-caja` actuales:

```css
/* ── Modal detalle de turno ──────────────────────────────────────── */
.modal-caja-detalle { max-width: 640px; }   /* modificador, mismo patrón que .modal-caja-sm en usuarios.html */

.detalle-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
.detalle-turno-id { color: var(--text-3); font-size: var(--text-sm); margin-bottom: 16px; }

.detalle-seccion { padding: 14px 0; border-top: 1px solid var(--border); }
.detalle-seccion:first-of-type { border-top: none; padding-top: 0; }
.detalle-seccion-titulo {
  font-size: var(--text-xs); font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--text-3); margin-bottom: 8px;
}
.detalle-fila { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; font-size: var(--text-sm); }
.detalle-fila-label { color: var(--text-2); }
.detalle-fila-valor { color: var(--text-1); font-weight: 600; text-align: right; }

.detalle-telefono { display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); }

/* Pill de estado — mismos tokens de color que ya usan las cards de turno */
.estado-pill { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: var(--text-xs); font-weight: 700; }
.estado-pill.agendado     { background: rgba(var(--blue-rgb), .15);  color: var(--blue); }
.estado-pill.presente,
.estado-pill.atendido     { background: rgba(var(--teal-rgb), .15);  color: var(--teal); }
.estado-pill.ausente      { background: rgba(var(--red-rgb), .15);   color: var(--red); }
.estado-pill.cancelado,
.estado-pill.reprogramado { background: rgba(var(--text-2-rgb), .15); color: var(--text-2); }

.detalle-historial-item { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; font-size: var(--text-sm); border-top: 1px solid var(--border); }
.detalle-historial-item:first-child { border-top: none; }
.detalle-historial-vacio { color: var(--text-3); font-size: var(--text-sm); padding: 8px 0; }
```

**Mapeo de color de `estado-pill`:** `agendado`→blue, `presente`/`atendido`→
teal (no hay verde propio en el design system, teal ya cumple ese rol
"positivo" en las cards de semana/día), `ausente`→red (mismo color que ya
usa `.turno-red` en las cards del calendario para ese estado), `cancelado`/
`reprogramado`→gris neutro con `var(--text-2)` / `rgba(var(--text-2-rgb), .15)`
— no existe `--text-3-rgb` en `design-tokens.css`, pero `--text-2-rgb` sí
existe y ya es el precedente establecido para pills neutras: `auditoria.html`
usa exactamente `color: var(--text-2); background: rgba(var(--text-2-rgb), .18)`
en `.accion-desbloquear`, `.accion-login` y `.accion-logout`. Se sigue ese
mismo patrón en vez de inventar un valor nuevo. De paso, `agendado`/
`presente`/`atendido` también pasan a `rgba(var(--x-rgb), .15)` en vez de
los valores rgb hardcodeados de mi borrador anterior — mismo criterio de
"cero valores inventados cuando ya existe la variable".

No se toca `dashboard.html` ni su paleta hardcodeada (`COLORES_ESTADO`) —
es la deuda ya documentada en `REDESIGN_DARKMODE.md` categoría D, fuera de
alcance acá.

---

## 7. Placeholder de acciones de comunicación

Sección vacía pero ya reservada en el layout (entre "Vecino" y
"Historial", ver diagrama §3), para no tener que reordenar el modal
cuando se implementen los botones reales en una fase futura:

```html
<div class="detalle-seccion detalle-acciones-placeholder">
  <div class="detalle-seccion-titulo">Comunicación</div>
  <p class="detalle-historial-vacio">Próximamente: enviar recordatorio por WhatsApp o email.</p>
</div>
```

Sin botones reales, sin `onclick`, solo el texto — ocupa el espacio para
que la Fase 2 (vista de detalle con acciones de comunicación, ítem ya
pendiente en `CLAUDE.md`) sea un cambio de contenido de esta sección, no
un rediseño del modal entero.

---

## 8. Orden de implementación

### Paso 1 — Backend: endpoint nuevo
- `GET /panel/turno/:id/completo` en `routes/panel.js` (§2)
- Checkpoint: probar con curl/Postman con JWT de cada rol — turno de un
  área propia (200 con turno+historial), turno de un área ajena para un
  operador/encargado (403), ID inexistente (404), historial con y sin
  turnos previos del vecino.
- Commit: `feat(panel): endpoint GET /panel/turno/:id/completo`

### Paso 2 — Modal de detalle en agenda.html (sin wiring todavía)
- HTML del modal (§3), CSS (§6), funciones `abrirDetalleTurno()`
  (reemplaza la actual), `cerrarDetalleTurno()`, `renderizarDetalleTurno()`
- Checkpoint: invocar `abrirDetalleTurno(id)` manualmente desde la consola
  del navegador con un ID real, confirmar que carga, muestra los 3
  bloques, el botón Copiar funciona, y cierra bien.
- Commit: `feat(panel): modal de detalle de turno en agenda.html`

### Paso 3 — Wiring: vista semana + vista día + buscador global
- Vista semana: el `onclick="abrirDetalleTurno(${tc.id})"` ya apunta a la
  función correcta — no requiere cambio de HTML, solo se prueba que el
  nuevo comportamiento funciona desde ahí.
- Vista día: agregar `onclick="abrirDetalleTurno(${t.id})"` a la card +
  `event.stopPropagation()` en cada botón de acción inline (Tomar/
  Cancelar/Presente/Ausente/Liberar) para que no disparen el modal también.
- `seleccionarResultadoBusqueda()`: agregar el `await abrirDetalleTurno(t.id)`
  final (§5).
- Checkpoint: click en card de semana abre el modal; click en card de día
  (fuera de los botones) abre el modal, y cada botón de acción de día
  sigue haciendo solo su acción sin abrir el modal; buscar un turno,
  seleccionarlo, confirmar que navega a vista día + resalta + abre el
  modal, cerrar el modal y confirmar que la card resaltada sigue visible.
- Commit: `feat(panel): abrir detalle de turno desde vista semana, vista día y buscador global`

### Paso 4 — Verificación de cierre
- grep: 0 hex hardcodeado en el CSS nuevo de agenda.html
- Confirmar que el modal de cancelar (`modal-fondo`/`cerrarModal()`)
  sigue funcionando sin interferencia del modal nuevo (IDs distintos)
- Confirmar dark/light mode: el modal nuevo hereda tokens, probar toggle
  de tema con el modal abierto
- Commit: `docs(claude): marcar vista de detalle de turno como completada` (actualiza CLAUDE.md, ítem de "Próximos pasos")
