// test-panel.js — Pruebas del panel de empleados
//
// Testea: login, middleware JWT, agenda, carga presencial, cancelación,
//         cancelación masiva, bloqueos, mensaje de servicio.
//
// Cómo usar:
//   1. Asegurarse de que el servidor esté corriendo: node index.js
//   2. Setear las credenciales de un usuario encargado:
//        $env:TEST_EMAIL="email@municipio.gov.ar"
//        $env:TEST_PASSWORD="la_contraseña"
//   3. Ejecutar: node test-panel.js
//
// Si los tests pasan, muestra OK en verde. Si fallan, muestra el error.
//
// Requiere Node.js 18+ (usa fetch nativo).

'use strict';

require('dotenv').config();

const BASE  = `http://localhost:${process.env.PORT || 3000}/panel`;
const EMAIL = process.env.TEST_EMAIL    || '';
const PASS  = process.env.TEST_PASSWORD || '';

// Colores para la consola (terminal ANSI)
const OK  = '\x1b[32m✓\x1b[0m';
const ERR = '\x1b[31m✗\x1b[0m';
const INF = '\x1b[36m→\x1b[0m';

let token = '';   // se llena en el test de login
let headers = {}; // se llena después del login

// Helper: hacer un request y verificar el status esperado.
// Devuelve { status, body } para que el test pueda inspeccionarlo.
async function req(metodo, ruta, body, statusEsperado) {
  const opts = {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${BASE}${ruta}`, opts);
  const data = await res.json().catch(() => ({}));

  if (res.status !== statusEsperado) {
    throw new Error(`HTTP ${res.status} (esperaba ${statusEsperado}): ${JSON.stringify(data)}`);
  }
  return { status: res.status, body: data };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function testLoginSinCredenciales() {
  const { body } = await req('POST', '/login', {}, 400);
  console.log(`${OK} Login sin credenciales → 400: "${body.error}"`);
}

async function testLoginCredencialesWrong() {
  const { body } = await req('POST', '/login', { email: 'noexiste@test.com', password: 'mal' }, 401);
  console.log(`${OK} Login credenciales incorrectas → 401: "${body.error}"`);
}

async function testLogin() {
  if (!EMAIL || !PASS) {
    console.log(`${ERR} TEST_EMAIL y TEST_PASSWORD no configurados — saltando tests autenticados`);
    process.exit(1);
  }
  const { body } = await req('POST', '/login', { email: EMAIL, password: PASS }, 200);

  if (!body.token) throw new Error('No vino token en la respuesta');

  token   = body.token;
  headers = { Authorization: `Bearer ${token}` };

  console.log(`${OK} Login exitoso — usuario: ${body.usuario.nombre} (rol: ${body.usuario.rol})`);
  console.log(`${INF} JWT: ${token.substring(0, 30)}...`);
  return body.usuario;
}

async function testTokenInvalido() {
  // Un request con token inventado debe dar 401
  const res = await fetch(`${BASE}/agenda`, {
    headers: { Authorization: 'Bearer token.falso.inventado' },
  });
  const data = await res.json();
  if (res.status !== 401) throw new Error(`Esperaba 401, obtuvo ${res.status}`);
  console.log(`${OK} Token inválido → 401: "${data.error}"`);
}

async function testSinToken() {
  // Un request sin token debe dar 401
  const res = await fetch(`${BASE}/agenda`);
  if (res.status !== 401) throw new Error(`Esperaba 401, obtuvo ${res.status}`);
  console.log(`${OK} Sin token → 401`);
}

async function testAgenda() {
  const hoy  = new Date().toISOString().substring(0, 10);
  const { body } = await req('GET', `/agenda?fecha=${hoy}`, null, 200);
  if (!Array.isArray(body)) throw new Error('La respuesta no es un array');
  console.log(`${OK} GET /agenda?fecha=${hoy} → ${body.length} turno(s)`);
  if (body.length > 0) {
    const t = body[0];
    console.log(`${INF}   Primer turno: ID ${t.id} | ${t.hora_inicio} | ${t.vecino_nombre} | ${t.estado}`);
  }
}

async function testServiciosDropdown() {
  const { body } = await req('GET', '/servicios', null, 200);
  if (!Array.isArray(body)) throw new Error('No es array');
  console.log(`${OK} GET /servicios → ${body.length} servicio(s): ${body.map(s => s.nombre).join(', ')}`);
  return body;
}

async function testOperadoresDropdown() {
  const { body } = await req('GET', '/operadores', null, 200);
  if (!Array.isArray(body)) throw new Error('No es array');
  console.log(`${OK} GET /operadores → ${body.length} operador(es): ${body.map(o => o.nombre).join(', ')}`);
  return body;
}

async function testDisponibilidad(serviceId) {
  // Buscar el próximo lunes hábil para la prueba
  const fecha = proximoLunes();
  const { body } = await req('GET', `/disponibilidad?serviceId=${serviceId}&fecha=${fecha}`, null, 200);
  if (!body.horariosLibres) throw new Error('No vino horariosLibres');
  console.log(
    `${OK} GET /disponibilidad serviceId=${serviceId} fecha=${fecha} → ` +
    `${body.horariosLibres.length} slot(s): ${body.horariosLibres.slice(0, 3).join(', ')}...`
  );
  return { fecha, ...body };
}

async function testCargaPresencial(serviceId, fecha, horario) {
  const { body } = await req('POST', '/turno', {
    dni:       '99999999',
    nombre:    'Vecino Test Panel',
    serviceId,
    fecha,
    horario,
  }, 201);
  if (!body.id) throw new Error('No vino ID del turno creado');
  console.log(`${OK} POST /turno (presencial) → turno ID ${body.id} | fecha: ${fecha} ${horario}`);
  return body.id;
}

async function testCambiarEstado(turnoId) {
  const { body } = await req('PATCH', `/turno/${turnoId}/estado`, { estado: 'presente' }, 200);
  if (!body.ok) throw new Error('No vino ok:true');
  console.log(`${OK} PATCH /turno/${turnoId}/estado → presente`);
}

async function testCambiarEstadoInvalido(turnoId) {
  // Intentar cambiar a 'cancelado' desde PATCH (no permitido, solo DELETE)
  const { body } = await req('PATCH', `/turno/${turnoId}/estado`, { estado: 'cancelado' }, 400);
  console.log(`${OK} PATCH con estado inválido → 400: "${body.error}"`);
}

async function testCancelar(turnoId) {
  const { body } = await req('DELETE', `/turno/${turnoId}`, {
    motivo: 'Prueba automática de cancelación desde test-panel.js'
  }, 200);
  if (!body.ok) throw new Error('No vino ok:true');
  console.log(`${OK} DELETE /turno/${turnoId} → cancelado`);
}

// Requiere token válido para llegar a la validación de motivo.
// Se llama desde la sección autenticada con un turnoId real.
async function testCancelarSinMotivo(turnoId) {
  const { body } = await req('DELETE', `/turno/${turnoId}`, { motivo: 'abc' }, 400);
  console.log(`${OK} DELETE motivo muy corto → 400: "${body.error}"`);
}

async function testMensajeServicio(serviceId) {
  const { body } = await req('GET', `/servicios/${serviceId}/mensaje`, null, 200);
  console.log(`${OK} GET /servicios/${serviceId}/mensaje → "${(body.mensaje_confirmacion || '').substring(0, 50)}..."`);
}

async function testBloqueos() {
  // Listar bloqueos (puede ser vacío si no hay)
  const { body } = await req('GET', '/bloqueos', null, 200);
  if (!Array.isArray(body)) throw new Error('No es array');
  console.log(`${OK} GET /bloqueos → ${body.length} bloqueo(s) activos`);
}

async function testLogout() {
  const { body } = await req('POST', '/logout', {}, 200);
  if (!body.ok) throw new Error('No vino ok:true');
  console.log(`${OK} POST /logout → ok`);
}

// Devuelve la fecha del próximo lunes en formato YYYY-MM-DD
function proximoLunes() {
  const hoy  = new Date();
  const dia  = hoy.getDay(); // 0=domingo, 1=lunes, ...
  const diff = dia === 0 ? 1 : (8 - dia) % 7 || 7;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diff);
  return lunes.toISOString().substring(0, 10);
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== TEST PANEL DE EMPLEADOS ===\n');
  let errores = 0;

  const run = async (nombre, fn) => {
    try {
      await fn();
    } catch (e) {
      console.log(`${ERR} ${nombre}: ${e.message}`);
      errores++;
    }
  };

  // 1. Tests sin autenticación (siempre corren)
  console.log('── Sin autenticación ──');
  await run('Login vacío',             testLoginSinCredenciales);
  await run('Login credenciales malas', testLoginCredencialesWrong);
  await run('Token inválido',          testTokenInvalido);
  await run('Sin token',               testSinToken);

  // 2. Login (necesita TEST_EMAIL y TEST_PASSWORD)
  console.log('\n── Autenticación ──');
  let usuario;
  try {
    usuario = await testLogin();
  } catch (e) {
    console.log(`${ERR} Login: ${e.message}`);
    console.log('\nNo se pueden ejecutar los tests autenticados. Configurá TEST_EMAIL y TEST_PASSWORD.\n');
    process.exit(1);
  }

  // 3. Tests autenticados
  console.log('\n── Endpoints autenticados ──');
  await run('Agenda hoy',           testAgenda);
  const servicios = await (async () => { let s; await run('Servicios dropdown', async () => { s = await testServiciosDropdown(); }); return s || []; })();
  await run('Operadores dropdown',  testOperadoresDropdown);

  // 4. Tests que requieren al menos un servicio disponible
  if (servicios.length > 0) {
    const svc = servicios[0];
    console.log(`\n── Carga presencial (servicio: "${svc.nombre}") ──`);

    let disp;
    await run('Disponibilidad',     async () => { disp = await testDisponibilidad(svc.id); });

    if (disp?.horariosLibres?.length >= 2) {
      // Usamos dos slots distintos: uno para testear cambios de estado,
      // otro para testear cancelación. Así el turno a cancelar sigue en 'agendado'.
      let turnoEstado, turnoCancelar;
      const slot0 = disp.horariosLibres[0];
      const slot1 = disp.horariosLibres[1];

      await run('Crear turno A (cambio estado)', async () => {
        turnoEstado = await testCargaPresencial(svc.id, disp.fecha, slot0);
      });
      await run('Crear turno B (cancelar)',      async () => {
        turnoCancelar = await testCargaPresencial(svc.id, disp.fecha, slot1);
      });

      if (turnoEstado) {
        await run('Estado inválido (PATCH)',  () => testCambiarEstadoInvalido(turnoEstado));
        await run('Marcar presente (PATCH)',  () => testCambiarEstado(turnoEstado));
      }

      if (turnoCancelar) {
        // testCancelarSinMotivo usa el turno B que sigue en 'agendado'
        await run('Cancel motivo corto (400)', () => testCancelarSinMotivo(turnoCancelar));
        await run('Cancelar (DELETE)',          () => testCancelar(turnoCancelar));
      }
    } else {
      console.log(`${INF} Sin slots disponibles para "${svc.nombre}" el próximo lunes — saltando tests de turno`);
    }

    await run('Mensaje de servicio', () => testMensajeServicio(svc.id));
  }

  await run('Bloqueos', testBloqueos);

  console.log('\n── Logout ──');
  await run('Logout', testLogout);

  // Resumen
  console.log('\n=== RESULTADO ===');
  if (errores === 0) {
    console.log('\x1b[32mTodos los tests pasaron ✓\x1b[0m\n');
  } else {
    console.log(`\x1b[31m${errores} test(s) fallaron\x1b[0m\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error fatal en el runner:', err);
  process.exit(1);
});
