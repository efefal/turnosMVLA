// scripts/test-smoke.js — Prueba de humo del sistema completo
//
// Verifica que motor.js, la base de datos y el flujo de reserva funcionan
// correctamente antes de hacer el corte definitivo en producción.
//
// Uso: node scripts/test-smoke.js
//
// Requisitos:
//   - MySQL corriendo con la BD motor_turnos
//   - Variables de entorno en .env (MOTOR_DB_*)
//   - Al menos un servicio y un operador con horario activo en la BD
//
// El script NO modifica datos reales: crea un vecino y turno de prueba
// con DNI 99000001 y los borra al final (Paso 11).

'use strict';

// dotenv debe cargarse ANTES de requerir db.js o motor.js, porque esos módulos
// leen process.env al instanciarse. Si se carga después, las variables llegan vacías.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db    = require('../db');
const motor = require('../motor');

// ─── Constantes de prueba ────────────────────────────────────────────────────

const DNI_PRUEBA       = '99000001';          // fuera del rango de DNIs reales en uso
const NOMBRE_PRUEBA    = 'Test Humo';
const SERVICIO_ID      = 1;                   // "Nueva Licencia" (ID 1 según el seed)
const FECHA_FERIADO    = '2026-06-15';        // Güemes trasladado al lunes — debe estar en feriados

// ─── Estado del script ───────────────────────────────────────────────────────

let turnoIdCreado  = null;   // se llena en paso 7, se usa en 8-10 y limpieza
let resumen        = { ok: 0, fallo: 0 };

// ─── Helpers de reporte ──────────────────────────────────────────────────────

// Imprime un paso exitoso y acumula en el resumen
function ok(label, detalle) {
  const sufijo = detalle ? ` — ${detalle}` : '';
  console.log(`  ✅ ${label}${sufijo}`);
  resumen.ok++;
}

// Imprime un paso fallido, muestra el error, y acumula en el resumen.
// NO lanza — el script continúa siempre para mostrar el panorama completo.
function fallo(label, err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ❌ ${label}`);
  console.log(`     Error: ${msg}`);
  resumen.fallo++;
}

// ─── Función auxiliar: primer día hábil futuro ───────────────────────────────
//
// Consulta la tabla feriados para saber qué días saltar, y luego busca
// el primer día de lunes a viernes que no sea feriado.
// Usa la hora local del proceso para el cálculo de fecha (no UTC) para que
// coincida con la lógica de MySQL cuando ambos corren en la misma zona horaria.
async function primerDiaHabil() {
  // Traer todos los feriados de los próximos 60 días en una sola query
  const [rows] = await db.query(`
    SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha
    FROM   feriados
    WHERE  fecha > CURDATE()
      AND  fecha <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
  `);
  const feriados = new Set(rows.map(r => r.fecha));

  for (let delta = 1; delta <= 60; delta++) {
    const d   = new Date();
    d.setDate(d.getDate() + delta);
    const dia = d.getDay(); // 0=domingo, 6=sábado

    if (dia === 0 || dia === 6) continue; // fin de semana

    // Armar "YYYY-MM-DD" con hora local para que el día sea correcto
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const dd  = String(d.getDate()).padStart(2, '0');
    const str = `${y}-${m}-${dd}`;

    if (!feriados.has(str)) return str;
  }

  throw new Error('No se encontró ningún día hábil en los próximos 60 días');
}

// ─── Función de limpieza ─────────────────────────────────────────────────────
//
// Borra todos los datos creados por el script. Se llama al final,
// tanto si el test pasó como si falló.
async function limpiar() {
  // Si crearCita() tuvo éxito, el turno quedó en BD (posiblemente cancelado ya).
  // La auditoría tiene FK hacia turnos, así que primero borramos auditoría.
  if (turnoIdCreado !== null) {
    await db.query(
      'DELETE FROM auditoria WHERE entidad_tipo = ? AND entidad_id = ?',
      ['turno', turnoIdCreado]
    );
    await db.query('DELETE FROM turnos WHERE id = ?', [turnoIdCreado]);
  }

  // Borrar el vecino de prueba por DNI (puede existir aunque crearCita haya fallado
  // si el fallo ocurrió después del UPSERT de vecinos y antes del commit).
  // Si la transacción hizo rollback, el vecino no existe y el DELETE no falla.
  await db.query('DELETE FROM vecinos WHERE dni = ?', [DNI_PRUEBA]);
}

// ─── Script principal ────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Prueba de humo — Motor de Turnos Municipal Villa La Angostura');
  console.log(`   Ejecutando: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Pequeña pausa para que el pool de db.js termine su verificación interna
  // antes de que empecemos a emitir output, así los logs de winston no se
  // intercalan con el encabezado.
  await new Promise(r => setTimeout(r, 200));

  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 1 — Conexión a la base de datos
  // ─────────────────────────────────────────────────────────────────────────
  console.log('Paso 1: Verificar conexión a motor_turnos');
  try {
    const [rows] = await db.query('SELECT DATABASE() AS nombre, VERSION() AS version');
    const { nombre, version } = rows[0];
    if (nombre === 'motor_turnos') {
      ok('Paso 1 — Conexión BD', `base de datos "${nombre}" | MySQL ${version}`);
    } else {
      fallo('Paso 1 — Conexión BD', new Error(`BD incorrecta: "${nombre}" (se esperaba "motor_turnos")`));
    }
  } catch (err) {
    fallo('Paso 1 — Conexión BD', err);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 2 — motor.js exporta las 7 funciones del contrato
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 2: Verificar que motor.js exporta las 7 funciones del contrato');
  const FUNCIONES_REQUERIDAS = [
    'obtenerServicios',
    'obtenerProveedores',
    'obtenerDisponibilidad',
    'obtenerDisponibilidadServicio',
    'crearCita',
    'cancelarCita',
    'obtenerCitasDelCliente',
  ];
  try {
    const faltantes = FUNCIONES_REQUERIDAS.filter(f => typeof motor[f] !== 'function');
    if (faltantes.length === 0) {
      ok('Paso 2 — motor.js', `${FUNCIONES_REQUERIDAS.length}/7 funciones presentes`);
    } else {
      fallo('Paso 2 — motor.js', new Error(`Funciones faltantes: ${faltantes.join(', ')}`));
    }
  } catch (err) {
    fallo('Paso 2 — motor.js', err);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 3 — obtenerServicios() devuelve al menos un servicio
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 3: obtenerServicios()');
  let duracionServicio = 30; // fallback; se sobreescribe si el paso 3 pasa
  try {
    const servicios = await motor.obtenerServicios();
    if (servicios.length === 0) {
      fallo('Paso 3 — obtenerServicios', new Error('Array vacío — no hay servicios activos en la BD'));
    } else {
      const svc = servicios.find(s => s.id === SERVICIO_ID);
      if (!svc) {
        fallo(
          'Paso 3 — obtenerServicios',
          new Error(
            `Servicio ID ${SERVICIO_ID} no encontrado. ` +
            `IDs disponibles: ${servicios.map(s => s.id).join(', ')}`
          )
        );
      } else {
        duracionServicio = svc.duration;
        ok(
          'Paso 3 — obtenerServicios',
          `${servicios.length} servicio(s) | ID ${SERVICIO_ID}: "${svc.name}" ${svc.duration} min`
        );
      }
    }
  } catch (err) {
    fallo('Paso 3 — obtenerServicios', err);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 4 — obtenerProveedores() devuelve al menos un operador
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 4: obtenerProveedores()');
  try {
    const proveedores = await motor.obtenerProveedores();
    if (proveedores.length === 0) {
      fallo('Paso 4 — obtenerProveedores', new Error('Array vacío — no hay operadores activos en la BD'));
    } else {
      const lista = proveedores
        .map(p => `${p.firstName} ${p.lastName} (ID ${p.id})`)
        .join(', ');
      ok('Paso 4 — obtenerProveedores', `${proveedores.length} operador(es): ${lista}`);
    }
  } catch (err) {
    fallo('Paso 4 — obtenerProveedores', err);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 5 — Disponibilidad en el próximo día hábil
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 5: obtenerDisponibilidadServicio() en el próximo día hábil');
  let fechaHabil     = null;  // se usa en pasos 7-10
  let horarioPrueba  = null;  // primer slot disponible — para crearCita
  let proveedorIdPrueba = null;

  try {
    fechaHabil = await primerDiaHabil();
    const disp = await motor.obtenerDisponibilidadServicio(SERVICIO_ID, fechaHabil);

    if (disp.horariosLibres.length === 0) {
      fallo(
        'Paso 5 — Disponibilidad hábil',
        new Error(
          `Sin slots para ${fechaHabil} (servicio ${SERVICIO_ID}). ` +
          `¿Hay operadores con horario activo ese día?`
        )
      );
    } else {
      horarioPrueba     = disp.horariosLibres[0];
      proveedorIdPrueba = disp.mapaHorarioOperador[horarioPrueba];
      ok(
        'Paso 5 — Disponibilidad hábil',
        `${fechaHabil}: ${disp.horariosLibres.length} slot(s) | ` +
        `primer slot: ${horarioPrueba} → operador ID ${proveedorIdPrueba}`
      );
    }
  } catch (err) {
    fallo('Paso 5 — Disponibilidad hábil', err);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 6 — El 15/06/2026 (feriado Güemes) no tiene slots disponibles
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\nPaso 6: obtenerDisponibilidadServicio() en feriado (${FECHA_FERIADO})`);
  try {
    const dispFeriado = await motor.obtenerDisponibilidadServicio(SERVICIO_ID, FECHA_FERIADO);
    if (dispFeriado.horariosLibres.length === 0) {
      ok(
        'Paso 6 — Feriado bloqueado',
        `${FECHA_FERIADO} correctamente bloqueado (0 slots)`
      );
    } else {
      fallo(
        'Paso 6 — Feriado bloqueado',
        new Error(
          `Se devolvieron ${dispFeriado.horariosLibres.length} slot(s) en un día feriado. ` +
          `¿Está ${FECHA_FERIADO} en la tabla feriados?`
        )
      );
    }
  } catch (err) {
    fallo('Paso 6 — Feriado bloqueado', err);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 7 — crearCita() con DNI ficticio de prueba
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 7: crearCita() con DNI de prueba');

  // Si el paso 5 falló no tenemos fecha ni horario — no tiene sentido seguir
  if (!fechaHabil || !horarioPrueba || !proveedorIdPrueba) {
    fallo('Paso 7 — crearCita', new Error('Dependencia fallida: Paso 5 no entregó fecha/horario/operador'));
  } else {
    try {
      // Calcular hora_fin: hora_inicio + duración del servicio en minutos
      const [hh, mm] = horarioPrueba.split(':').map(Number);
      const finMin   = hh * 60 + mm + duracionServicio;
      const horaFin  = `${String(Math.floor(finMin / 60)).padStart(2, '0')}:${String(finMin % 60).padStart(2, '0')}`;

      const cita = await motor.crearCita({
        serviceId:    SERVICIO_ID,
        providerId:   proveedorIdPrueba,
        nombre:       NOMBRE_PRUEBA,
        dni:          DNI_PRUEBA,
        fechaHora:    `${fechaHabil} ${horarioPrueba}:00`,
        fechaHoraFin: `${fechaHabil} ${horaFin}:00`,
        canal:        'web',
      });

      turnoIdCreado = cita.id;
      ok(
        'Paso 7 — crearCita',
        `Turno #${cita.id} | ${fechaHabil} ${horarioPrueba}–${horaFin} | ` +
        `serviceId=${cita.serviceId} providerId=${cita.providerId}`
      );
    } catch (err) {
      fallo('Paso 7 — crearCita', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 8 — El turno existe en BD con estado='agendado'
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 8: Verificar en BD que el turno tiene estado=agendado');
  if (turnoIdCreado === null) {
    fallo('Paso 8 — BD agendado', new Error('Dependencia fallida: Paso 7 no creó el turno'));
  } else {
    try {
      const [rows] = await db.query(
        `SELECT t.id, t.estado, t.fecha, t.hora_inicio, t.operador_id, v.nombre AS vecino_nombre
         FROM   turnos  t
         JOIN   vecinos v ON v.id = t.vecino_id
         WHERE  t.id = ?`,
        [turnoIdCreado]
      );

      if (rows.length === 0) {
        fallo('Paso 8 — BD agendado', new Error(`Turno #${turnoIdCreado} no encontrado en la tabla turnos`));
      } else if (rows[0].estado !== 'agendado') {
        fallo(
          'Paso 8 — BD agendado',
          new Error(`Estado incorrecto: "${rows[0].estado}" (se esperaba "agendado")`)
        );
      } else {
        const r = rows[0];
        ok(
          'Paso 8 — BD agendado',
          `ID ${r.id} | estado="${r.estado}" | ${r.fecha} ${r.hora_inicio} | ` +
          `operador_id=${r.operador_id} | vecino="${r.vecino_nombre}"`
        );
      }
    } catch (err) {
      fallo('Paso 8 — BD agendado', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 9 — cancelarCita() cambia el estado
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 9: cancelarCita()');
  if (turnoIdCreado === null) {
    fallo('Paso 9 — cancelarCita', new Error('Dependencia fallida: Paso 7 no creó el turno'));
  } else {
    try {
      await motor.cancelarCita(turnoIdCreado);
      ok('Paso 9 — cancelarCita', `Turno #${turnoIdCreado} cancelado`);
    } catch (err) {
      fallo('Paso 9 — cancelarCita', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 10 — La BD refleja estado='cancelado'
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 10: Verificar en BD que el turno tiene estado=cancelado');
  if (turnoIdCreado === null) {
    fallo('Paso 10 — BD cancelado', new Error('Dependencia fallida: Paso 7 no creó el turno'));
  } else {
    try {
      const [rows] = await db.query(
        'SELECT id, estado FROM turnos WHERE id = ?',
        [turnoIdCreado]
      );

      if (rows.length === 0) {
        fallo('Paso 10 — BD cancelado', new Error(`Turno #${turnoIdCreado} no encontrado en la tabla turnos`));
      } else if (rows[0].estado !== 'cancelado') {
        fallo(
          'Paso 10 — BD cancelado',
          new Error(`Estado incorrecto: "${rows[0].estado}" (se esperaba "cancelado")`)
        );
      } else {
        ok('Paso 10 — BD cancelado', `ID ${rows[0].id} | estado="${rows[0].estado}" ✓`);
      }
    } catch (err) {
      fallo('Paso 10 — BD cancelado', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PASO 11 — Limpiar datos de prueba
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\nPaso 11: Limpiar datos de prueba');
  try {
    await limpiar();
    const detalle = turnoIdCreado
      ? `turno #${turnoIdCreado} + auditoría + vecino DNI ${DNI_PRUEBA} eliminados`
      : `vecino DNI ${DNI_PRUEBA} eliminado (turno no creado)`;
    ok('Paso 11 — Limpieza', detalle);
  } catch (err) {
    fallo('Paso 11 — Limpieza', err);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESUMEN FINAL
  // ─────────────────────────────────────────────────────────────────────────
  const total = resumen.ok + resumen.fallo;
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Resultado: ${resumen.ok} ✅  /  ${resumen.fallo} ❌  (${total} pasos)`);
  if (resumen.fallo === 0) {
    console.log('   Sistema listo — todos los pasos pasaron correctamente.');
  } else {
    console.log('   Hay pasos fallidos — revisar los errores antes de desplegar.');
  }
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Cerrar el pool de MySQL para que Node.js pueda salir limpiamente.
  // Sin esto, el proceso queda colgado esperando conexiones abiertas.
  await db.end();

  // Exit code 1 si algún paso falló — permite detectar la falla desde scripts bash/CI
  process.exit(resumen.fallo === 0 ? 0 : 1);
}

// Captura errores inesperados que escapen a los try/catch individuales
main().catch(async (err) => {
  console.error('\n💥 Error inesperado en el script de prueba:');
  console.error(err);
  // Intentar limpieza de emergencia antes de salir
  try { await limpiar(); } catch (_) { /* ignorar errores de limpieza en emergencia */ }
  try { await db.end();  } catch (_) { /* ignorar */ }
  process.exit(1);
});
