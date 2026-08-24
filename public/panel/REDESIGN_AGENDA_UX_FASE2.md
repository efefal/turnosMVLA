# Plan — Modal de detalle de turno: acciones, notas e historial expandible (Fase 2)
# Continúa REDESIGN_AGENDA_UX_FASE1.md (ya implementada y pusheada).
# Restricciones: Vanilla JS · sin frameworks · reusar funciones existentes,
# no duplicar lógica (tomarTurno/cambiarEstado/liberarTurno/abrirCancelar/
# seleccionarResultadoBusqueda se llaman tal cual, sin reimplementar).

---

## Contexto y decisiones ya tomadas

- Nota única por turno, editable las veces que haga falta (no historial de
  versiones — solo la última).
- Historial expandible: acordeón in-place + link "Ver turno completo →"
  que reusa `seleccionarResultadoBusqueda()` tal cual (mismo mecanismo que
  el buscador global: cambia fecha, cambia a vista día, resalta la card,
  reabre el modal con el turno destino).
- Modal tras una acción exitosa (Tomar/Presente/Ausente/Liberar/Cancelar):
  **se refresca in-place** llamando de nuevo `abrirDetalleTurno(id)` — no
  se cierra. La cancelación es la única que hoy cierra un modal (el de
  confirmación, `modal-fondo`, distinto del de detalle) — eso sigue
  igual; el modal de **detalle** queda abierto mostrando el turno ya
  `Cancelado`, sin botones de acción (mismo criterio que cualquier otro
  estado final).
- Trazabilidad de la nota: 2 columnas nuevas (`notas_actualizada_por`,
  `notas_actualizada_en`) para acceso directo en el modal, más la entrada
  de `auditoria` de siempre para el historial completo.
- Guardado de nota: botón explícito "Guardar nota", sin autoguardado.

### Permisos para editar notas — sin instrucción previa, propuesta con razones

No hay una regla obvia heredada de otro endpoint que aplique tal cual acá,
así que la defino explícitamente:

- **`directivo` → solo lectura**, igual que en todo el resto del panel
  (`rechazarDirectivo()`, patrón usado en cada endpoint de escritura).
- **`operador`/`encargado`/`sistemas` con acceso al área → pueden ver y
  editar la nota, sin restringirla a "solo mis propios turnos asignados"**
  (a diferencia de `PATCH /turno/:id/estado`, que sí es operador-only).
  Motivo: el caso de uso explícito es que "otro operador vea qué pasó
  antes" — restringir la escritura al operador asignado iría en contra de
  ese propósito. Además, un turno puede necesitar una nota antes de que
  nadie lo tome (`operador_id IS NULL`), así que atarlo a `operador_id`
  tampoco funcionaría en ese caso.
- Mismo chequeo de acceso que el resto de los endpoints de turno:
  `tieneAccesoAlArea(req, area_id)`.

---

## 1. Migración de esquema

Mismo criterio que la migración `email → usuario`: agregar columnas
nullable, sin backfill (arrancan vacías, no hay dato previo que migrar).

```sql
ALTER TABLE turnos
  ADD COLUMN notas TEXT NULL AFTER motivo_cancelacion,
  ADD COLUMN notas_actualizada_por INT UNSIGNED NULL AFTER notas,
  ADD COLUMN notas_actualizada_en DATETIME NULL AFTER notas_actualizada_por,
  ADD CONSTRAINT fk_turnos_notas_actualizada_por
    FOREIGN KEY (notas_actualizada_por) REFERENCES usuarios(id);
```

No requiere `Fase C`/endurecimiento posterior — a diferencia de
`usuario`, esta columna no reemplaza nada existente, así que no hay una
fase de limpieza final. Es una migración de un solo paso.

**Verificación post-migración:** `DESCRIBE turnos` confirma las 3
columnas nuevas, todas `NULL` por defecto; `SELECT COUNT(*) FROM turnos
WHERE notas IS NOT NULL` da `0` inmediatamente después (nada las pobló
todavía).

---

## 2. Backend

### `PATCH /panel/turno/:id/notas` — endpoint nuevo

```js
// PATCH /panel/turno/:id/notas
// Actualiza (o borra, si se manda vacío) la nota del turno. A diferencia
// de /turno/:id/estado, no tiene restricción de transición de estado —
// una nota es información de contexto, no depende de en qué estado esté
// el turno (ej. anotar por qué faltó alguien en un turno ya 'ausente').
router.patch('/turno/:id/notas', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const id = parseInt(req.params.id, 10);
  const { notas } = req.body;

  try {
    const [rows] = await pool.query(`
      SELECT t.id, s.area_id
      FROM   turnos t
      JOIN   servicios s ON t.servicio_id = s.id
      WHERE  t.id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado.' });
    }
    if (!tieneAccesoAlArea(req, rows[0].area_id)) {
      return res.status(403).json({ error: 'Sin permiso para modificar este turno.' });
    }

    const notasLimpias = (notas || '').trim() || null; // string vacío → NULL, no ''

    await pool.query(
      'UPDATE turnos SET notas = ?, notas_actualizada_por = ?, notas_actualizada_en = NOW() WHERE id = ?',
      [notasLimpias, req.usuario.id, id]
    );

    await auditar(req.usuario.id, 'turno', id, 'modificar', {
      campo: 'notas',
      modificado_por: req.usuario.nombre,
    }, req.ip);

    res.json({ ok: true, notas: notasLimpias, notas_actualizada_por: req.usuario.nombre, notas_actualizada_en: new Date() });

  } catch (err) {
    logger.error('[panel] Error al actualizar notas del turno:', err);
    res.status(500).json({ error: 'No se pudieron guardar las notas.' });
  }
});
```

No se guarda el texto de la nota en el detalle de auditoría (a diferencia
de `estado_anterior`/`estado_nuevo`) — el contenido ya vive en
`turnos.notas`, no hace falta duplicarlo en el JSON de auditoría; alcanza
con dejar registrado que ese campo cambió y quién lo cambió.

### `GET /panel/turno/:id/completo` — ampliar

Agregar a la query principal (routes/panel.js:564-584):

```sql
SELECT
  t.id, t.fecha, t.hora_inicio, t.hora_fin, t.estado,
  t.canal_origen, t.motivo_cancelacion, t.created_at,
  t.notas, t.notas_actualizada_en,
  un.nombre AS notas_actualizada_por_nombre,   -- NUEVO JOIN
  v.id       AS vecino_id,
  ...
FROM turnos t
JOIN vecinos   v ON t.vecino_id   = v.id
JOIN servicios s ON t.servicio_id = s.id
LEFT JOIN usuarios u  ON t.operador_id           = u.id
LEFT JOIN usuarios un ON t.notas_actualizada_por = un.id   -- NUEVO
JOIN areas     a ON s.area_id     = a.id
WHERE t.id = ?
```

Se trae el **nombre** de quien actualizó la nota (no solo el id) para no
necesitar una consulta extra en el frontend — mismo criterio que
`operador_nombre` ya resuelto vía `LEFT JOIN usuarios u`.

Agregar a la query de `historial` (routes/panel.js:598-607):

```sql
SELECT
  t.id, t.fecha, t.hora_inicio, t.estado, t.notas,   -- + t.notas
  s.nombre AS servicio_nombre
FROM turnos t
JOIN servicios s ON t.servicio_id = s.id
WHERE t.vecino_id = ? AND t.id != ?
ORDER BY t.fecha DESC, t.hora_inicio DESC
LIMIT 10
```

Sin cambios en el `LIMIT 10` ni en el resto del filtro — la nota viaja
gratis en la misma consulta que ya se hacía.

---

## 3. Frontend — modal de detalle

### 3a. Botones de acción — replican `renderizarTablaDia()` 1:1

En `renderizarDetalleTurno(data)` (agenda.html:1650+), agregar el mismo
bloque de decisión que ya existe en `renderizarTablaDia()`
(agenda.html:1424-1444), usando `t = data.turno` y el global
`usuarioRol` (ya seteado en `init()`, disponible en todo el archivo):

```js
let accionesHTML = '';
if (usuarioRol !== 'directivo') {
  if (!t.operador_id && t.estado === 'agendado') {
    accionesHTML = `
      <button class="btn btn-secondary" onclick="tomarTurnoDesdeDetalle(${t.id})">Tomar</button>
      <button class="btn btn-danger"    onclick="abrirCancelar(${t.id})">Cancelar</button>`;
  } else if (t.operador_id && t.estado === 'agendado') {
    accionesHTML = `
      <button class="btn btn-primary"   onclick="cambiarEstadoDesdeDetalle(${t.id}, 'presente')">Presente</button>
      <button class="btn btn-danger"    onclick="cambiarEstadoDesdeDetalle(${t.id}, 'ausente')">Ausente</button>
      <button class="btn btn-secondary" onclick="liberarTurnoDesdeDetalle(${t.id})">Liberar</button>`;
  }
  // Estados finales o rol directivo → sin botones, igual que en la card
}
```

Se agrega como una sección más al final de `detalle-contenido` (antes del
historial), con su propio contenedor `detalle-acciones`.

**Por qué `...DesdeDetalle` y no las funciones originales directo en el
`onclick`:** las funciones originales (`tomarTurno`, `cambiarEstado`,
`liberarTurno`) ya terminan en `cargar()` (recarga la agenda de atrás) —
eso se mantiene sin tocar, porque las cards siguen usando esas mismas
funciones. Lo único que hace falta agregar es el refresco in-place del
modal, que **no debe dispararse cuando la acción se llama desde una card**
(ahí no hay modal de detalle abierto para ese turno). Se resuelve con 3
wrappers finos, sin duplicar la llamada a la API ni la lógica de negocio:

```js
// Wrappers: acción real (sin tocar) + refresco in-place del modal de detalle.
// abrirCancelar() no necesita wrapper — confirmarCancelacion() ya sabe a qué
// modal de detalle refrescar (ver 3c).
async function tomarTurnoDesdeDetalle(id) {
  await tomarTurno(id);
  if (document.getElementById('modal-detalle-fondo').classList.contains('abierto')) {
    await abrirDetalleTurno(id);
  }
}
async function cambiarEstadoDesdeDetalle(id, estado) {
  await cambiarEstado(id, estado);
  if (document.getElementById('modal-detalle-fondo').classList.contains('abierto')) {
    await abrirDetalleTurno(id);
  }
}
async function liberarTurnoDesdeDetalle(id) {
  await liberarTurno(id);
  if (document.getElementById('modal-detalle-fondo').classList.contains('abierto')) {
    await abrirDetalleTurno(id);
  }
}
```

`tomarTurno`/`cambiarEstado`/`liberarTurno` **no se tocan** — siguen
siendo las mismas funciones que usan las cards de la agenda, sin cambios.

### 3b. `abrirCancelar()` — la dependencia de `turnosActuales`, documentada

`abrirCancelar(id)` (agenda.html:2175) lee `turnosActuales.find(x => x.id
=== id)` para mostrar el nombre/DNI del vecino en el modal de
confirmación. **No se modifica** — sigue funcionando sin cambios porque
la invariante que la sostiene ya se cumple hoy, y se sigue cumpliendo acá:

- Click en una card → el turno ya está en `turnosActuales` (es parte de
  la vista visible).
- Buscador global → `seleccionarResultadoBusqueda()` navega (cambia
  `fechaActual`, `cambiarVista('dia')`, que recarga `turnosActuales`)
  **antes** de abrir el modal.
- "Ver turno completo →" (nuevo, punto 4) → **reusa la misma función**
  `seleccionarResultadoBusqueda()`, así que hereda la misma garantía: para
  cuando el modal de detalle esté abierto, `turnosActuales` ya incluye
  ese turno.

Documentar esto con un comentario explícito arriba de `abrirCancelar()`,
para que quede claro por qué es seguro no defenderse ahí con un chequeo
adicional.

### 3c. Refresco in-place tras Cancelar

`confirmarCancelacion()` (agenda.html:2192-2227) hoy hace `cerrarModal()`
(cierra `modal-fondo`, el de confirmación) y `cargar()`. Se agrega el
mismo patrón de refresco condicional, usando `turnoACancelar` (todavía
accesible ahí antes de que `cerrarModal()` lo ponga en `null`):

```js
async function confirmarCancelacion() {
  ...
  const idCancelado = turnoACancelar;   // guardar antes de cerrarModal() (que lo limpia)
  cerrarModal();
  mostrarAlerta('ok', 'Turno cancelado correctamente.');
  cargar();

  if (document.getElementById('modal-detalle-fondo').classList.contains('abierto')) {
    await abrirDetalleTurno(idCancelado);
  }
}
```

Resultado: el modal de confirmación se cierra (como siempre), y si el
modal de **detalle** estaba abierto para ese turno, se refresca mostrando
"Cancelado" y sin botones — no se cierra.

### 3d. Sección de notas

`directivo` es de solo lectura en todo el panel (ej. `servicios-admin.html`
oculta directamente la card de alta para ese rol) — la sección de notas
sigue el mismo criterio: el textarea queda `readonly` y el botón
"Guardar nota" no se renderiza, en vez de depender solo del `403` del
backend como única barrera:

```html
<div class="detalle-seccion">
  <div class="detalle-seccion-titulo">Notas</div>
  <textarea id="detalle-notas-input" class="detalle-notas-textarea"
            placeholder="Sin notas." ${usuarioRol === 'directivo' ? 'readonly' : ''}
            >${esc(t.notas || '')}</textarea>
  <div class="detalle-notas-pie">
    <span class="detalle-notas-meta" id="detalle-notas-meta">
      ${t.notas_actualizada_en
        ? `Editado por ${esc(t.notas_actualizada_por_nombre)} — ${formatoFechaHora(t.notas_actualizada_en)}`
        : ''}
    </span>
    ${usuarioRol !== 'directivo'
      ? `<button class="btn btn-secondary btn-sm" id="btn-guardar-notas" onclick="guardarNotas(${t.id})">Guardar nota</button>`
      : ''}
  </div>
</div>
```

```js
async function guardarNotas(id) {
  const btn   = document.getElementById('btn-guardar-notas');
  const meta  = document.getElementById('detalle-notas-meta');
  const texto = document.getElementById('detalle-notas-input').value;

  btn.disabled    = true;
  btn.textContent = 'Guardando...';

  const res = await apiFetch(`/panel/turno/${id}/notas`, {
    method: 'PATCH',
    body: JSON.stringify({ notas: texto }),
  });

  btn.disabled = false;
  if (!res || !res.ok) {
    btn.textContent = 'Guardar nota';
    mostrarAlerta('error', 'No se pudieron guardar las notas.');
    return;
  }

  const data = await res.json();
  // Reflejar el valor real guardado (el backend normaliza "solo espacios" a
  // NULL) — si el usuario escribió espacios y nada más, el textarea debe
  // quedar vacío después de guardar, no mostrando los espacios que tipeó.
  document.getElementById('detalle-notas-input').value = data.notas || '';
  btn.textContent = 'Guardado ✓';
  meta.textContent = `Editado por ${esc(data.notas_actualizada_por)} — ${formatoFechaHora(data.notas_actualizada_en)}`;
  setTimeout(() => { btn.textContent = 'Guardar nota'; }, 1500);
}
```

Reusa `formatoFechaHora()` (agenda.html:1645), ya existente para el campo
"Cargado" del turno — mismo formato `DD/MM/AAAA HH:MM hs`.

---

## 4. Frontend — historial expandible

### Acordeón

```js
const historialHTML = data.historial.length === 0
  ? `<p class="detalle-historial-vacio">Sin turnos anteriores.</p>`
  : data.historial.map(h => {
      const fechaStr = typeof h.fecha === 'string' ? h.fecha.substring(0, 10) : h.fecha;
      return `
        <div class="detalle-historial-item" onclick="toggleHistorialItem(this)">
          <span>${esc(formatoFechaLarga(fechaStr))} — ${esc(h.servicio_nombre)}</span>
          <span class="estado-pill ${h.estado}">${ESTADOS[h.estado] || h.estado}</span>
        </div>
        <div class="detalle-historial-detalle">
          <p class="detalle-historial-nota">${h.notas ? esc(h.notas) : 'Sin notas.'}</p>
          <a class="detalle-historial-link"
             onclick="event.stopPropagation(); seleccionarResultadoBusqueda({id: ${h.id}, fecha: '${fechaStr}'})">
            Ver turno completo →
          </a>
        </div>`;
    }).join('');
```

```js
// Acordeón simple: toggle de la clase .abierto en el <div> hermano
// siguiente (.detalle-historial-detalle), que arranca oculto por CSS.
function toggleHistorialItem(item) {
  item.nextElementSibling.classList.toggle('abierto');
}
```

### "Ver turno completo →" — reuso literal, sin wrapper

Se llama `seleccionarResultadoBusqueda({id, fecha})` directamente — el
mismo objeto shape que ya consume esa función (`t.id`, `t.fecha`), sin
ningún wrapper ni función nueva. `event.stopPropagation()` evita que el
click en el link también dispare el `toggleHistorialItem()` del item
padre.

---

## 5. CSS nuevo

```css
/* ── Notas (modal de detalle) ────────────────────────────────── */
.detalle-notas-textarea {
  width: 100%;
  min-height: 70px;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-4);
  color: var(--text-1);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  resize: vertical;
}
.detalle-notas-textarea:focus { outline: none; border-color: var(--border-hi); }
.detalle-notas-pie {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--gap-sm); margin-top: 0.4rem;
}
.detalle-notas-meta { font-size: var(--text-xs); color: var(--text-3); }

/* ── Acordeón de historial ────────────────────────────────────── */
.detalle-historial-detalle {
  display: none;
  padding: 0.5rem 0.65rem;
  margin: -0.25rem 0 0.4rem;
  background: var(--bg-1);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}
.detalle-historial-detalle.abierto { display: block; }
.detalle-historial-nota { color: var(--text-2); margin: 0 0 0.4rem; white-space: pre-wrap; }
.detalle-historial-link {
  color: var(--teal); font-size: var(--text-xs); font-weight: 600;
  cursor: pointer; text-decoration: none;
}
.detalle-historial-link:hover { text-decoration: underline; }

/* ── Acciones dentro del modal de detalle ────────────────────── */
.detalle-acciones { display: flex; gap: var(--gap-sm); margin-top: 0.5rem; }
```

`.detalle-historial-item` gana `cursor: pointer` (no lo tenía, era
estático) — se agrega junto a las reglas existentes.

---

## 6. Orden de implementación — 3 pasos, cada uno con commit propio

### Paso A — Esquema + backend

1. `ALTER TABLE` (sección 1).
2. `PATCH /panel/turno/:id/notas` (sección 2).
3. Ampliar `GET /panel/turno/:id/completo` (turno principal + historial).
4. Verificación por API (curl/token, sin UI todavía):
   - `DESCRIBE turnos` → 3 columnas nuevas, todas NULL.
   - `PATCH /panel/turno/:id/notas` con texto → `200`, `notas` guardada, `notas_actualizada_por`/`_en` pobladas, fila nueva en `auditoria` (`campo:'notas'`).
   - `PATCH` con `notas: ''` → guarda `NULL` (no string vacío).
   - `GET /panel/turno/:id/completo` → incluye `notas`, `notas_actualizada_por_nombre`, `notas_actualizada_en`; `historial[].notas` presente.
   - Rol `directivo` → `403` al intentar `PATCH /notas`.
   - Usuario sin acceso al área → `403`.
5. Commit: `feat(db): agregar notas a turnos con trazabilidad de quién y cuándo`.

### Paso B — Botones de acción + refresco in-place

1. Bloque `accionesHTML` en `renderizarDetalleTurno()`.
2. Wrappers `tomarTurnoDesdeDetalle`/`cambiarEstadoDesdeDetalle`/`liberarTurnoDesdeDetalle`.
3. Refresco in-place en `confirmarCancelacion()`.
4. Comentario documentando la dependencia de `turnosActuales` en `abrirCancelar()`.
5. CSS `.detalle-acciones`.
6. Verificación en navegador real (checklist sección 7, primeros 2 ítems).
7. Commit: `feat(panel): botones de acción en el modal de detalle de turno`.

### Paso C — Notas + historial expandible

1. Sección de notas + `guardarNotas()`.
2. Acordeón de historial + `toggleHistorialItem()` + link "Ver turno completo →".
3. CSS de notas y acordeón.
4. Verificación en navegador real (checklist sección 7, últimos 3 ítems).
5. Commit: `feat(panel): notas de turno e historial expandible en el modal de detalle`.

Cada paso se prueba y comitea antes de pasar al siguiente — si algo falla en B, A ya está commiteado y funcionando de forma independiente (el backend de notas no depende de que existan los botones de acción en el modal).

---

## 7. Casos a verificar

### Paso A (backend, por API)
- [ ] Las 3 columnas nuevas existen, `NULL` por defecto.
- [ ] `PATCH /notas` guarda texto, puebla `_por`/`_en`, genera auditoría.
- [ ] `PATCH /notas` con vacío guarda `NULL`.
- [ ] `directivo` → `403`. Fuera de área → `403`.
- [ ] `GET /completo` trae los 3 campos nuevos del turno y `notas` en cada item de `historial`.

### Paso B (botones de acción)
- [ ] **Los 4 estados de botones coinciden con la card:** para un mismo turno, abrir el modal de detalle y comparar contra la card de agenda — turno sin tomar (Tomar+Cancelar), turno tomado (Presente+Ausente+Liberar), estado final (sin botones), rol `directivo` (sin botones) — los 4 casos, mismo turno, mismos botones en ambos lugares.
- [ ] Refresco in-place funciona para las 4 acciones **sin cerrar el modal**: Tomar → pasa a mostrar Presente/Ausente/Liberar; Presente/Ausente → pasa a estado final sin botones; Liberar → vuelve a mostrar Tomar/Cancelar; Cancelar → modal de confirmación se cierra, modal de detalle queda abierto mostrando "Cancelado" sin botones.
- [ ] La agenda de atrás (card) también se actualiza tras cada acción (via `cargar()`, sin cambios) — confirmar que no quedó desincronizada del modal.
- [ ] **Carrera `cargar()` / `abrirDetalleTurno()`**: con el modal abierto, ejecutar una acción (ej. Tomar) dispara ambos requests casi al mismo tiempo (agenda de atrás + refresco del modal). Ambos leen datos ya persistidos por el PATCH previo, así que no debería haber inconsistencia — confirmarlo mirándolo en la práctica (Network tab / orden de respuestas), no solo por lectura de código.
- [ ] Ningún error de consola en las 4 acciones.

### Paso C (notas + historial)
- [ ] La nota se guarda (botón "Guardar nota" → "Guardando..." → "Guardado ✓" → vuelve a "Guardar nota").
- [ ] **Nota que queda vacía tras `trim()`** (ej. el usuario escribió solo espacios): el backend la guarda como `NULL` (ya cubierto en Paso A) — confirmar además que, tras el guardado exitoso, el **textarea se actualiza visualmente a vacío** (no queda mostrando los espacios que en la base ya son `NULL`).
- [ ] Tras guardar, aparece "Editado por [nombre] — [fecha/hora]" debajo del textarea.
- [ ] Cerrar el modal y reabrirlo (mismo turno) → la nota persiste (viene de `GET /completo`, no de memoria).
- [ ] La nota aparece resumida (o "Sin notas.") al expandir la línea correspondiente en el **historial de otro turno del mismo vecino** — abrir el detalle de un turno más nuevo del mismo vecino, expandir el turno con la nota recién guardada en el acordeón, confirmar que se ve.
- [ ] **"Ver turno completo →" desde un turno fuera de la vista actual**: parado en la vista día de una fecha X, abrir el detalle de un turno de esa fecha, expandir un item del historial que sea de una fecha Y distinta (no visible en la agenda actual), click en "Ver turno completo →" → confirmar que navega a la fecha Y, cambia a vista día, resalta la card, y el modal de detalle muestra el turno de Y — sin error, aunque ese turno no estuviera en `turnosActuales` al momento del click (justamente lo que prueba que la navegación previa resuelve la dependencia).
- [ ] **Permisos de notas por rol**: operador puede ver y editar la nota de un turno de su área (tomado por él o no, sin restringir a "solo mis turnos"). Directivo ve la nota pero el textarea aparece `readonly` y sin botón "Guardar nota" — y si se fuerza el `PATCH /notas` igual por API, el backend responde `403` (defensa en profundidad, no solo ocultar el botón).
- [ ] Ningún error de consola.

---

## Commits propuestos

```
feat(db): agregar notas a turnos con trazabilidad de quién y cuándo
feat(panel): botones de acción en el modal de detalle de turno
feat(panel): notas de turno e historial expandible en el modal de detalle
```
