// =============================================================
// index.js — Bot de Telegram con flujo conversacional completo
//             y persistencia real en archivo JSON
// =============================================================

// ---------------------------------------------------------------
// 1. CARGAR VARIABLES DE ENTORNO
// ---------------------------------------------------------------
require('dotenv').config();

// ---------------------------------------------------------------
// 2. IMPORTAR DEPENDENCIAS
// ---------------------------------------------------------------
const logger      = require('./logger');
const TelegramBot = require('node-telegram-bot-api');

// "fs" (File System) es un módulo nativo de Node.js (no necesita instalarse).
// Nos permite leer y escribir archivos en el disco, que es cómo lograremos
// la persistencia real de los datos.
const fs = require('fs');

// "path" es otro módulo nativo de Node.js que ayuda a construir rutas
// de archivos de forma segura, sin importar el sistema operativo
// (Windows usa "\", Linux/Mac usan "/").
const path = require('path');

// "ea" es el módulo de integración con Easy!Appointments.
// Centraliza todas las llamadas a la API del motor de reservas:
// obtener servicios, consultar disponibilidad, crear y cancelar citas.
// Al importarlo acá, index.js puede usar esas funciones sin conocer
// los detalles de cómo se comunica con la API.
const ea = require('./ea');

// ---------------------------------------------------------------
// 3. RUTA AL ARCHIVO DE LA BASE DE DATOS
// ---------------------------------------------------------------
// Construimos la ruta absoluta al archivo JSON de usuarios.
// __dirname es una variable especial de Node.js que contiene
// la carpeta donde está este archivo (index.js).
// path.join() une las partes de la ruta con el separador correcto.
const RUTA_DB = path.join(__dirname, 'data', 'usuarios.json');

// ---------------------------------------------------------------
// 4. FUNCIONES DE ACCESO A LA BASE DE DATOS
// ---------------------------------------------------------------

// leerUsuarios(): Lee el archivo JSON del disco y lo convierte en un
// array de objetos JavaScript. Lo llamamos "leer" en vez de usar
// require() porque require() guarda el resultado en caché (memoria)
// y no reflejaría los cambios que hacemos al guardar nuevos usuarios.
function leerUsuarios() {
  // El try/catch previene que el bot se apague ante fallos de I/O:
  // si el archivo no existe, está corrupto o es ilegible, el error
  // queda contenido aquí y la función devuelve un array vacío como
  // red de seguridad, en lugar de propagar una excepción no controlada.
  try {
    if (!fs.existsSync(RUTA_DB)) {
      return [];
    }
    const contenido = fs.readFileSync(RUTA_DB, 'utf-8');
    // JSON.parse() convierte el texto JSON en un objeto JavaScript utilizable.
    return JSON.parse(contenido);
  } catch (error) {
    logger.error('Error al leer el archivo de usuarios:', error);
    return [];
  }
}

// guardarUsuarios(): Recibe el array completo de usuarios y lo
// sobreescribe en el archivo JSON del disco, haciendo los cambios permanentes.
function guardarUsuarios(arrayUsuarios) {
  // El try/catch previene que el bot se apague ante fallos de I/O:
  // si el disco está lleno, los permisos fallan o hay un error de escritura,
  // el error queda contenido aquí en lugar de tumbar el proceso completo.
  try {
    // JSON.stringify() convierte el array JavaScript de vuelta a texto JSON.
    // El tercer argumento (2) agrega sangría de 2 espacios para que el archivo
    // sea legible si lo abrimos con un editor de texto.
    const contenidoJson = JSON.stringify(arrayUsuarios, null, 2);
    fs.writeFileSync(RUTA_DB, contenidoJson, 'utf-8');
  } catch (error) {
    logger.error('Error al guardar en el archivo de usuarios:', error);
  }
}

// buscarUsuarioPorDni(): Lee los usuarios frescos del disco y busca
// el que coincida con el DNI recibido.
// Devuelve el objeto del usuario si lo encuentra, o undefined si no.
function buscarUsuarioPorDni(dni) {
  const usuarios = leerUsuarios();
  return usuarios.find((usuario) => usuario.dni === dni.trim());
}

// ---------------------------------------------------------------
// 5. CATÁLOGO DE TRÁMITES DISPONIBLES
// ---------------------------------------------------------------
// TRAMITES: array de strings con los nombres visibles de cada trámite.
// Se carga dinámicamente desde Easy!Appointments al iniciar el bot.
// Sigue siendo un array de strings para que toda la lógica de índices
// y callbacks del bot no necesite cambios: TRAMITES[0], TRAMITES[1], etc.
let TRAMITES = [];

// TRAMITES_COMPLETOS: array de objetos con todos los datos del servicio
// tal como los devuelve Easy!Appointments: { id, name, duration, ... }.
// Necesitamos los IDs numéricos para consultar disponibilidad y crear citas.
// Siempre se carga junto con TRAMITES y tienen el mismo orden.
let TRAMITES_COMPLETOS = [];

// cargarTramites(): consulta la API de Easy!Appointments y llena las dos
// variables de arriba. Se llama al iniciar el bot.
// Si la API no responde, TRAMITES queda vacío y el error aparece en el log.
// El bot sigue funcionando y avisará al usuario si intenta sacar un turno
// mientras los trámites no están disponibles.
async function cargarTramites() {
  try {
    const servicios = await ea.obtenerServicios();
    if (!servicios || servicios.length === 0) {
      console.warn('⚠️  No se encontraron trámites en Easy!Appointments.');
      return;
    }
    TRAMITES_COMPLETOS = servicios;
    TRAMITES = servicios.map((s) => s.name);
    logger.info(`✅ Trámites cargados: ${TRAMITES.join(', ')}`);
  } catch (error) {
    logger.error('❌ Error al cargar trámites desde Easy!Appointments:', error.message);
  }
}

// Devuelve un array con los próximos N días hábiles (lunes a viernes) a partir de hoy.
function proximosDiasHabiles(cantidad) {
  const dias = [];
  const fecha = new Date();
  while (dias.length < cantidad) {
    fecha.setDate(fecha.getDate() + 1);
    const diaSemana = fecha.getDay(); // 0 = Domingo, 6 = Sábado
    if (diaSemana !== 0 && diaSemana !== 6) {
      dias.push(new Date(fecha));
    }
  }
  return dias;
}

// Formatea un objeto Date como texto legible en español (ej: "martes 17 de marzo").
function formatearFechaTexto(fecha) {
  return fecha.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// Formatea un objeto Date como string compacto para usar en callback_data (ej: "2026-03-17").
function formatearFechaClave(fecha) {
  return fecha.toISOString().split('T')[0];
}

// Construye el texto legible de una semana hábil dado su primer y último día.
// Si los dos días caen en el mismo mes: "Semana del 7 al 11 de abril".
// Si cruzan mes: "Semana del 28 de abril al 2 de mayo".
function construirLabelSemana(primero, ultimo) {
  const dia1 = primero.getDate();
  const dia2 = ultimo.getDate();
  const mes1 = primero.toLocaleDateString('es-AR', { month: 'long' });
  const mes2 = ultimo.toLocaleDateString('es-AR', { month: 'long' });
  return mes1 === mes2
    ? `Semana del ${dia1} al ${dia2} de ${mes1}`
    : `Semana del ${dia1} de ${mes1} al ${dia2} de ${mes2}`;
}

// Devuelve un array de objetos semana { label, fechaInicio, fechaFin } con los
// días hábiles disponibles dentro de los próximos cantidadDias días corridos,
// agrupados por semana calendario (lunes–viernes).
function proximasSemanas(cantidadDias) {
  const hoy = new Date();
  const semanasMap = new Map(); // clave: fecha del lunes de esa semana → [Date, ...]

  for (let i = 0; i <= cantidadDias; i++) {
    const fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + i);
    const dow = fecha.getDay(); // 0 = domingo, 6 = sábado
    if (dow === 0 || dow === 6) continue;

    // Calculamos el lunes de la semana para usarlo como clave de agrupación.
    const lunes = new Date(fecha);
    lunes.setDate(fecha.getDate() - (dow - 1));
    const clave = formatearFechaClave(lunes);

    if (!semanasMap.has(clave)) semanasMap.set(clave, []);
    semanasMap.get(clave).push(new Date(fecha));
  }

  return [...semanasMap.values()].map((dias) => {
    const primero = dias[0];
    const ultimo  = dias[dias.length - 1];
    return {
      label:       construirLabelSemana(primero, ultimo),
      fechaInicio: formatearFechaClave(primero),
      fechaFin:    formatearFechaClave(ultimo),
    };
  });
}

// Convierte el array de semanas en filas del Inline Keyboard.
// callback_data: "semana_YYYY-MM-DD_YYYY-MM-DD" (fechaInicio_fechaFin).
// Siempre agrega al final un botón para volver al selector de trámite.
function construirBotonesSemanas(semanas) {
  const filas = semanas.map((s) => ([{
    text: s.label,
    callback_data: `semana_${s.fechaInicio}_${s.fechaFin}`,
  }]));
  filas.push([{ text: '⬅️ Volver a elegir trámite', callback_data: 'volver_tramites' }]);
  return filas;
}

// ---------------------------------------------------------------
// 5b. TECLADO DE GESTIÓN DINÁMICO
// ---------------------------------------------------------------
// Devuelve el Inline Keyboard del menú principal adaptado a si el vecino
// tiene turnos activos o no. Sin turnos, Modificar y Cancelar no aplican.
function construirTecladoGestion(tieneTurnos) {
  const filas = [
    [{ text: '➕ Nuevo Trámite', callback_data: 'nuevo_tramite' }],
  ];
  if (tieneTurnos) {
    filas.push([{ text: '✏️ Modificar Turno', callback_data: 'modificar_turno' }]);
    filas.push([{ text: '❌ Cancelar Turno',  callback_data: 'cancelar_turno'  }]);
  }
  filas.push([{ text: '🔚 Finalizar', callback_data: 'finalizar_sesion' }]);
  return filas;
}

// ---------------------------------------------------------------
// 6. VALIDAR Y OBTENER EL TOKEN
// ---------------------------------------------------------------
const token = process.env.TELEGRAM_TOKEN;

if (!token) {
  logger.error('❌ Error: No se encontró TELEGRAM_TOKEN en el archivo .env');
  process.exit(1);
}

// ---------------------------------------------------------------
// 7. CREAR LA INSTANCIA DEL BOT
// ---------------------------------------------------------------
const bot = new TelegramBot(token, { polling: true });

logger.info('✅ Bot iniciado correctamente. Esperando mensajes...');
cargarTramites();

// ---------------------------------------------------------------
// 8. MEMORIA DE ESTADO DE LAS CONVERSACIONES
// ---------------------------------------------------------------
// Objeto que guarda el estado actual de cada usuario en la conversación.
//
// Estados posibles:
//   - 'INICIAL'               → El usuario no inició ningún flujo aún.
//   - 'ESPERANDO_DNI'         → Le pedimos el DNI, aguardamos su respuesta.
//   - 'ESPERANDO_NOMBRE'      → El DNI no existe; le pedimos nombre y apellido.
//   - 'MENU_GESTION'          → El DNI existe; mostramos el menú de gestión con botones.
//   - 'ESPERANDO_TRAMITE'     → Ya tenemos nombre; le pedimos elegir trámite.
//   - 'ESPERANDO_DIA'         → Trámite elegido; mostramos selector de semanas.
//   - 'ESPERANDO_FECHA'       → Semana elegida; mostramos días hábiles de esa semana.
//   - 'ESPERANDO_HORARIO'     → Fecha elegida; mostramos horarios por Inline Keyboard.
//   - 'ESPERANDO_CANCELACION'              → Mostramos los turnos activos para que elija cuál borrar.
//   - 'ESPERANDO_MODIFICACION'             → Mostramos los turnos activos para que elija cuál modificar.
//   - 'ESPERANDO_CONFIRMACION'             → Mostramos el resumen del turno antes de crear la cita.
//   - 'ESPERANDO_CONFIRMACION_CANCELACION' → Mostramos el resumen del turno antes de cancelarlo.
//
// Ejemplo: { 123456789: 'ESPERANDO_DNI', 987654321: 'ESPERANDO_NOMBRE' }
const estadosUsuarios = {};

// ---------------------------------------------------------------
// 9. MEMORIA TEMPORAL DE REGISTROS EN PROCESO
// ---------------------------------------------------------------
// Cuando un usuario nuevo se está registrando, necesitamos recordar
// los datos que nos fue dando a lo largo de varios mensajes (DNI y nombre)
// para poder armar el objeto completo al final.
//
// Ejemplo: { 123456789: { dni: '30123456', nombre: 'Juan Pérez' } }
const registrosEnProceso = {};

// ---------------------------------------------------------------
// 9b. TEMPORIZADORES DE SESIÓN POR INACTIVIDAD
// ---------------------------------------------------------------
// Cada clave es un chatId; el valor es el ID del setTimeout activo
// para ese usuario. Permite cancelar y renovar el temporizador en
// cada interacción, reiniciando el contador de 10 minutos.
//
// Ejemplo: { 123456789: <Timeout>, 987654321: <Timeout> }
let timeoutsSesion = {};

// ---------------------------------------------------------------
// 10. FUNCIONES AUXILIARES DE LÓGICA
// ---------------------------------------------------------------

// Detecta si el texto es un saludo o una intención de inicio de trámite.
// Cubre saludos comunes, pedidos de turno, consultas y comandos de ayuda.
// Usamos toLowerCase() + normalize() para ignorar mayúsculas y tildes,
// así "Quiero un Turno" y "quiero un turno" se tratan igual.
function esSaludo(texto) {
  const textoNormalizado = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // elimina diacríticos (tildes, ñ → n, etc.)
    .trim();

  const disparadores = [
    // Saludos
    'hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes',
    'buenas noches', 'hey', 'ey',
    // Intención directa de turno
    'turno', 'quiero un turno', 'necesito un turno', 'sacar turno',
    'pedir turno', 'reservar turno', 'solicitar turno', 'tramite', 'tramites',
    // Consultas generales
    'consulta', 'informacion', 'info', 'ayuda', 'ayudame',
    'como funciona', 'que puedo hacer', 'que tramites hay',
    // Comandos de texto
    'start', 'comenzar', 'empezar', 'iniciar', 'menu',
  ];

  return disparadores.some((d) => textoNormalizado.includes(d));
}

// Valida que el DNI tenga entre 7 y 8 dígitos numéricos únicamente.
function esDniValido(texto) {
  return /^\d{7,8}$/.test(texto.trim());
}

// Devuelve el mensaje de bienvenida estándar que pide el DNI.
function mensajeBienvenida() {
  return (
    '¡Hola! Bienvenido al sistema de turnos de prueba.\n' +
    'Por favor, ingresá tu número de DNI (sin puntos ni espacios) para consultar tu estado.'
  );
}

// Construye el array de filas de botones para el menú de trámites.
// Acepta un parámetro opcional "indicesPermitidos": un array de números
// que indica cuáles índices de TRAMITES deben mostrarse como botones.
// Si no se pasa el parámetro, se muestran TODOS los trámites (comportamiento
// original, usado cuando el usuario es nuevo y nunca sacó ningún turno).
// IMPORTANTE: preservar los índices originales de TRAMITES es clave porque
// el callback_data los usa para recuperar el nombre en CALLBACK A.
function teclasMenuTramites(indicesPermitidos) {
  // Si no se recibió el parámetro, construimos un array con todos los índices
  // posibles usando map() sobre el propio array TRAMITES.
  const indices = indicesPermitidos !== undefined
    ? indicesPermitidos
    : TRAMITES.map((_, i) => i);

  // Por cada índice permitido armamos una fila con un único botón.
  // El texto visible es el nombre del trámite; el callback_data lleva el índice
  // original para que CALLBACK A pueda identificarlo correctamente.
  const filas = indices.map((i) => ([{
    text: TRAMITES[i],
    callback_data: `tramite_${i}`,
  }]));
  // Botón de cancelación siempre presente como última fila.
  filas.push([{ text: '❌ Cancelar', callback_data: 'cancelar_tramite' }]);
  return filas;
}

// ---------------------------------------------------------------
// 10b. GESTIÓN DE TIMEOUT POR INACTIVIDAD
// ---------------------------------------------------------------
// gestionarTimeout(): Se llama al inicio de cada interacción del usuario
// (mensaje de texto o pulsación de botón). Su trabajo es reiniciar el
// contador de inactividad de 10 minutos para ese chatId.
//
// El try/catch en el bloque interno previene que un fallo al enviar el
// mensaje de expiración apague el bot.
function gestionarTimeout(chatId) {
  // Si ya hay un temporizador activo para este usuario, lo cancelamos.
  // Esto "reinicia el reloj" con cada nueva interacción.
  if (timeoutsSesion[chatId]) {
    clearTimeout(timeoutsSesion[chatId]);
    delete timeoutsSesion[chatId];
  }

  // Si el usuario está en estado INICIAL no hay ningún trámite en curso,
  // por lo que no tiene sentido crear un temporizador de vencimiento.
  if ((estadosUsuarios[chatId] || 'INICIAL') === 'INICIAL') {
    return;
  }

  // Creamos un nuevo temporizador de 10 minutos (600 000 ms).
  // Si el usuario no interactúa antes de que se cumpla, lo devolvemos
  // al estado INICIAL y limpiamos cualquier dato parcial en memoria.
  timeoutsSesion[chatId] = setTimeout(async () => {
    // Limpiamos el registro en proceso (datos parciales del trámite).
    delete registrosEnProceso[chatId];

    // Volvemos al estado neutro para que el usuario deba empezar de cero.
    estadosUsuarios[chatId] = 'INICIAL';

    // Eliminamos la referencia al temporizador ya ejecutado.
    delete timeoutsSesion[chatId];

    // Notificamos al usuario que su sesión expiró.
    try {
      await bot.sendMessage(
        chatId,
        '⏳ Tu sesión ha expirado por inactividad. ' +
        'Por favor, escribí tu DNI o el comando /start para volver al menú principal.'
      );
    } catch (error) {
      logger.error(`Error al enviar mensaje de timeout al usuario ${chatId}:`, error);
    }
  }, 600000);
}

// ---------------------------------------------------------------
// 11. MANEJADOR PRINCIPAL DE MENSAJES
// ---------------------------------------------------------------
// Toda la lógica conversacional vive en este único bloque.
// El evento 'message' se dispara con cada mensaje que llega al bot.
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const texto = msg.text;

  // Ignoramos mensajes sin texto (fotos, stickers, archivos, etc.)
  if (!texto) return;

  // Reinicio global del flujo: si el usuario escribe "menu", "hola", etc.
  // desde cualquier estado que no sea INICIAL, limpiamos su sesión y lo
  // llevamos directo a pedir el DNI, sin pasar por ninguna rama posterior.
  const estadoActualParaReinicio = estadosUsuarios[chatId] || 'INICIAL';
  if (esSaludo(texto) && estadoActualParaReinicio !== 'INICIAL') {
    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'ESPERANDO_DNI';
    bot.sendMessage(chatId, mensajeBienvenida(), { parse_mode: 'Markdown' });
    return;
  }

  // Reiniciamos (o cancelamos) el temporizador de inactividad con cada mensaje.
  // Si el usuario está en INICIAL no se crea timeout; en cualquier otro estado
  // el reloj se reinicia desde cero para darle 10 minutos más de sesión activa.
  gestionarTimeout(chatId);

  // Obtenemos el estado actual del usuario (INICIAL si es la primera vez)
  const estadoActual = estadosUsuarios[chatId] || 'INICIAL';

  logger.info(`📩 ${msg.chat.first_name} (${chatId}) | Estado: ${estadoActual} | Texto: "${texto}"`);

  // ==============================================================
  // RAMA A: Comando /start o saludo en estado INICIAL
  // Ambos disparan el mismo flujo: pedir el DNI.
  // ==============================================================
  if (texto.startsWith('/start') || (estadoActual === 'INICIAL' && esSaludo(texto))) {
    estadosUsuarios[chatId] = 'ESPERANDO_DNI';
    bot.sendMessage(chatId, mensajeBienvenida());
    return;
  }

  // ==============================================================
  // RAMA B: El bot espera que el usuario ingrese su DNI
  // ==============================================================
  if (estadoActual === 'ESPERANDO_DNI') {

    // B1: Validación de formato
    if (!esDniValido(texto)) {
      bot.sendMessage(
        chatId,
        '⚠️ El DNI ingresado no es válido.\n' +
        'Tiene que ser solo números, sin puntos ni espacios, y tener entre 7 y 8 dígitos.\n' +
        'Ejemplo: *12345678*\n\n' +
        'Intentá de nuevo o escribí *Menu* para volver al inicio.',
        { parse_mode: 'Markdown' }
      );
      return; // Mantenemos el estado ESPERANDO_DNI para reintento
    }

    const dniIngresado = texto.trim();

    // Consultamos Easy!Appointments buscando por el email ficticio que usamos
    // al crear citas: "dni_NUMERODNI@municipio.local". Si hay citas, el vecino
    // ya está registrado; si no hay ninguna, lo tratamos como nuevo usuario.
    const emailVecino = `dni_${dniIngresado}@municipio.local`;
    let citasActivas;
    try {
      citasActivas = await ea.obtenerCitasDelCliente(emailVecino);
    } catch (error) {
      logger.error(`❌ Error al consultar citas para DNI ${dniIngresado}:`, error.message);
      bot.sendMessage(
        chatId,
        '⚠️ Hubo un problema al consultar tu información. Puede ser una falla momentánea.\n\n' +
        'Esperá unos segundos e intentá ingresar tu DNI de nuevo, o escribí *Menu* para volver al inicio.',
        { parse_mode: 'Markdown' }
      );
      // Mantenemos el estado ESPERANDO_DNI para que el vecino pueda reintentar.
      return;
    }

    const nombre      = citasActivas.nombreCliente;
    const citasCargadas = citasActivas.citas ?? [];

    // B2c: nombreCliente es null → el vecino no existe en EA, iniciamos el registro.
    if (!nombre) {
      registrosEnProceso[chatId] = { dni: dniIngresado };
      estadosUsuarios[chatId] = 'ESPERANDO_NOMBRE';

      bot.sendMessage(
        chatId,
        'No encontramos registros para tu DNI. Vamos a registrarte.\n' +
        'Por favor, ingresá tu Nombre y Apellido:'
      );
      return;
    }

    // El vecino existe en EA (nombreCliente no es null). Guardamos DNI y nombre
    // anticipadamente para que cualquier acción del menú ya tenga sus datos.
    registrosEnProceso[chatId] = { dni: dniIngresado, nombre };
    estadosUsuarios[chatId] = 'MENU_GESTION';

    // B2a: El vecino existe Y tiene turnos activos → mostramos la lista y el menú completo.
    if (citasCargadas.length > 0) {

      const listaTurnos = citasCargadas.map((cita) => {
        const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
        const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
        const fechaISO      = cita.start.substring(0, 10);
        const fechaTexto    = formatearFechaTexto(new Date(`${fechaISO}T12:00:00`));
        const horario       = cita.start.substring(11, 16);
        return { tramite: tramiteNombre, fecha: fechaTexto, horario };
      });

      const renglonesTurnos = listaTurnos.map((t, i) =>
        `  *${i + 1}.* ${t.tramite} — ${t.fecha} a las ${t.horario} hs`
      );
      const textoBienvenida =
        `👋 Hola *${nombre}*, estos son tus turnos activos:\n\n` +
        renglonesTurnos.join('\n') +
        '\n\n¿Qué querés hacer?';

      bot.sendMessage(chatId, textoBienvenida, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: construirTecladoGestion(true) },
      });
      return;
    }

    // B2b: El vecino existe pero no tiene turnos activos → menú reducido.
    bot.sendMessage(
      chatId,
      `👋 Hola *${nombre}*, no tenés turnos activos por el momento.\n\n¿Qué querés hacer?`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: construirTecladoGestion(false) },
      }
    );
    return;
  }

  // ==============================================================
  // RAMA C: El bot espera que el usuario ingrese su nombre y apellido
  // ==============================================================
  if (estadoActual === 'ESPERANDO_NOMBRE') {

    const nombreIngresado = texto.trim();

    // Guardamos el nombre en el registro temporal junto al DNI que ya teníamos
    registrosEnProceso[chatId].nombre = nombreIngresado;

    // Pasamos al siguiente estado: elegir el trámite
    estadosUsuarios[chatId] = 'ESPERANDO_TRAMITE';

    // Enviamos el mensaje con el Inline Keyboard de trámites.
    // teclasMenuTramites() devuelve el array de filas listo para usar en reply_markup.
    bot.sendMessage(
      chatId,
      `¡Bienvenido, *${nombreIngresado}*! ¿Qué trámite querés realizar?`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: teclasMenuTramites() },
      }
    );
    return;
  }

  // ==============================================================
  // RAMA D: Mensaje fuera de contexto (estado INICIAL, sin saludo)
  // Nota: la selección de trámite se realiza ahora mediante botones
  // (Inline Keyboard) y se procesa en el manejador callback_query.
  // ==============================================================
  // Construimos un mensaje orientador según el estado actual del usuario.
  // Si está en medio de un flujo, le explicamos qué se espera de él en ese paso.
  // En todos los casos le recordamos que puede escribir Menu para reiniciar.
  const mensajesOrientadores = {
    ESPERANDO_DNI:          'Estoy esperando que ingreses tu número de DNI (solo números, sin puntos ni espacios).\n\nEjemplo: *12345678*',
    ESPERANDO_NOMBRE:       'Estoy esperando que ingreses tu nombre y apellido completos.\n\nEjemplo: *Juan Pérez*',
    ESPERANDO_TRAMITE:      'Por favor, usá los botones para elegir el trámite que querés realizar.',
    ESPERANDO_DIA:          'Por favor, usá los botones para elegir la semana en la que querés sacar el turno.',
    ESPERANDO_FECHA:        'Por favor, usá los botones para elegir el día de tu turno.',
    ESPERANDO_HORARIO:      'Por favor, usá los botones para elegir el horario de tu turno.',
    ESPERANDO_CANCELACION:  'Por favor, usá los botones para seleccionar el turno que querés cancelar.',
    ESPERANDO_MODIFICACION: 'Por favor, usá los botones para seleccionar el turno que querés modificar.',
    MENU_GESTION:           'Por favor, usá los botones del menú para elegir qué querés hacer.',
  };

  const orientacion = mensajesOrientadores[estadoActual] || 'No estoy seguro de en qué paso estamos.';

  bot.sendMessage(
    chatId,
    `${orientacion}\n\nSi preferís empezar de cero, escribí *Menu*.`,
    { parse_mode: 'Markdown' }
  );
});

// ---------------------------------------------------------------
// 12. MANEJADOR DE CALLBACKS (botones Inline Keyboard)
// ---------------------------------------------------------------
// El evento 'callback_query' se dispara cada vez que el usuario
// hace clic en un botón de un Inline Keyboard.
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data; // El valor de callback_data del botón presionado

  // Reiniciamos el temporizador de inactividad con cada pulsación de botón,
  // igual que hacemos en el manejador de mensajes de texto.
  gestionarTimeout(chatId);

  // Siempre respondemos al callback para que Telegram quite el "reloj" del botón.
  bot.answerCallbackQuery(query.id);

  const estadoActual = estadosUsuarios[chatId];

  // ==============================================================
  // CALLBACK A: El usuario eligió un TRÁMITE desde el Inline Keyboard
  // ==============================================================
  if (estadoActual === 'ESPERANDO_TRAMITE' && data.startsWith('tramite_')) {

    // Extraemos el índice del callback_data (ej: "tramite_1" → "1").
    // parseInt() convierte ese string a número entero; el segundo argumento
    // (10) indica base decimal para evitar interpretaciones incorrectas.
    const indice = parseInt(data.replace('tramite_', ''), 10);

    // Verificamos que el índice sea un número válido y que exista en el array.
    // isNaN() devuelve true si parseInt() no pudo convertir el string a número.
    if (isNaN(indice) || !TRAMITES[indice]) {
      bot.sendMessage(chatId, '⚠️ Ocurrió un error al procesar tu selección. Por favor, intentá de nuevo.');
      return;
    }

    // Guardamos el nombre del trámite (no el índice) en el registro temporal.
    // El resto del flujo siempre trabaja con el texto legible, no con números.
    registrosEnProceso[chatId].tramite = TRAMITES[indice];
    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    // Mostramos el selector de semanas: primer paso del nuevo flujo de fechas.
    const semanasT = proximasSemanas(30);
    bot.sendMessage(
      chatId,
      `📋 Trámite elegido: *${TRAMITES[indice]}*\n\n📅 Ahora elegí una semana:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: construirBotonesSemanas(semanasT) },
      }
    );
    return;
  }

  // ==============================================================
  // CALLBACK A1b: El vecino canceló la selección de trámite
  // ==============================================================
  if (estadoActual === 'ESPERANDO_TRAMITE' && data === 'cancelar_tramite') {

    const dniCancelar = registrosEnProceso[chatId]?.dni;

    // Si por alguna razón no hay DNI en memoria, tratamos al usuario como nuevo.
    if (!dniCancelar) {
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      bot.sendMessage(
        chatId,
        'No hay problema. Si en algún momento querés sacar un turno, escribí *Menu* y arrancamos de nuevo.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let citasCancelar;
    try {
      citasCancelar = await ea.obtenerCitasDelCliente(`dni_${dniCancelar}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas al cancelar trámite (DNI ${dniCancelar}):`, error.message);
      bot.sendMessage(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    if (citasCancelar.citas && citasCancelar.citas.length > 0) {

      // El vecino ya tiene turnos activos → lo devolvemos al menú de gestión.
      const nombreC    = citasCancelar.nombreCliente || registrosEnProceso[chatId].nombre || 'vecino/a';
      const renglones  = citasCancelar.citas.map((cita, i) => {
        const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
        const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
        const fechaTexto    = formatearFechaTexto(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
        const horario       = cita.start.substring(11, 16);
        return `  *${i + 1}.* ${tramiteNombre} — ${fechaTexto} a las ${horario} hs`;
      });

      registrosEnProceso[chatId].nombre = nombreC;
      estadosUsuarios[chatId] = 'MENU_GESTION';

      bot.sendMessage(
        chatId,
        `👋 Hola *${nombreC}*, estos son tus turnos activos:\n\n` +
        renglones.join('\n') + '\n\n¿Qué querés hacer?',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: construirTecladoGestion(true) },
        }
      );
    } else {
      // Sin turnos → es vecino nuevo que canceló; despedida amigable.
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      bot.sendMessage(
        chatId,
        'No hay problema. Si en algún momento querés sacar un turno, escribí *Menu* y arrancamos de nuevo.',
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  // ==============================================================
  // CALLBACK A2: El usuario eligió una SEMANA → mostramos los días hábiles
  // ==============================================================
  if (estadoActual === 'ESPERANDO_DIA' && data.startsWith('semana_')) {

    // callback_data: "semana_2026-04-07_2026-04-11"
    // Las fechas ISO solo tienen guiones, así que el único guión bajo es el separador.
    const [fechaInicio, fechaFin] = data.replace('semana_', '').split('_');

    // Recorremos el rango día a día y nos quedamos solo con los días hábiles.
    const diasDeSemana = [];
    const cursor = new Date(`${fechaInicio}T12:00:00`);
    const finSemana = new Date(`${fechaFin}T12:00:00`);
    while (cursor <= finSemana) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) diasDeSemana.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const botonesDias = diasDeSemana.map((dia) => ([{
      text: formatearFechaTexto(dia),
      callback_data: `fecha_${formatearFechaClave(dia)}`,
    }]));
    botonesDias.push([{ text: '⬅️ Volver a elegir semana', callback_data: 'volver_semanas' }]);

    estadosUsuarios[chatId] = 'ESPERANDO_FECHA';

    bot.sendMessage(chatId, '📅 Ahora elegí el día:', {
      reply_markup: { inline_keyboard: botonesDias },
    });
    return;
  }

  // ==============================================================
  // CALLBACK A2b: El vecino quiere volver al selector de trámite
  // ==============================================================
  if (estadoActual === 'ESPERANDO_DIA' && data === 'volver_tramites') {

    const dniVT = registrosEnProceso[chatId]?.dni;

    let citasVT;
    try {
      citasVT = await ea.obtenerCitasDelCliente(`dni_${dniVT}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas al volver a trámite (DNI ${dniVT}):`, error.message);
      bot.sendMessage(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    const tramitesActivos = new Set();
    (citasVT.citas || []).forEach((cita) => {
      const servicio = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
      if (servicio) tramitesActivos.add(servicio.name);
    });

    const indicesDisponibles = TRAMITES
      .map((nombre, i) => ({ nombre, i }))
      .filter(({ nombre }) => !tramitesActivos.has(nombre))
      .map(({ i }) => i);

    if (indicesDisponibles.length === 0) {
      bot.sendMessage(chatId, '⚠️ Ya tenés turnos activos para todos los trámites disponibles.');
      return;
    }

    delete registrosEnProceso[chatId].tramite;
    estadosUsuarios[chatId] = 'ESPERANDO_TRAMITE';

    bot.sendMessage(chatId, '📋 ¿Qué trámite querés realizar?', {
      reply_markup: { inline_keyboard: teclasMenuTramites(indicesDisponibles) },
    });
    return;
  }

  // ==============================================================
  // CALLBACK A3: El usuario quiere volver al selector de semanas
  // ==============================================================
  if (estadoActual === 'ESPERANDO_FECHA' && data === 'volver_semanas') {

    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    const semanasVolver = proximasSemanas(30);
    bot.sendMessage(chatId, '📅 Elegí una semana:', {
      reply_markup: { inline_keyboard: construirBotonesSemanas(semanasVolver) },
    });
    return;
  }

  // ==============================================================
  // CALLBACK B: El usuario eligió una FECHA
  // ==============================================================
  if (estadoActual === 'ESPERANDO_FECHA' && data.startsWith('fecha_')) {

    // Extraemos la clave de fecha del callback_data (ej: "fecha_2026-03-17" → "2026-03-17")
    const fechaClave = data.replace('fecha_', '');

    // Convertimos la clave a texto legible usando el mismo formato con el que
    // guardamos los turnos en el JSON, para que la comparación posterior sea exacta.
    const fechaObj = new Date(`${fechaClave}T12:00:00`); // Mediodía evita desfases de zona horaria
    const fechaTexto = formatearFechaTexto(fechaObj);

    // Recuperamos el trámite y el DNI del usuario actual desde la memoria temporal.
    // El trámite lo usamos para la condición global; el DNI para la condición personal.
    const tramiteElegido = registrosEnProceso[chatId].tramite;
    const dniActual      = registrosEnProceso[chatId].dni;

 // --- CONSULTA DE DISPONIBILIDAD EN EASY!APPOINTMENTS ---

    // Buscamos el objeto completo del trámite en TRAMITES_COMPLETOS
    // para obtener su ID numérico, que es lo que necesita la API.
    const servicioElegido = TRAMITES_COMPLETOS.find((s) => s.name === tramiteElegido);

    // Si no encontramos el servicio, algo falló al cargar los trámites.
    // Recargamos y pedimos al usuario que intente de nuevo.
    if (!servicioElegido) {
      await cargarTramites();
      bot.sendMessage(
        chatId,
        '⚠️ Hubo un problema al identificar el trámite. Por favor, escribí /start para intentar de nuevo.'
      );
      estadosUsuarios[chatId] = 'INICIAL';
      delete registrosEnProceso[chatId];
      return;
    }

    // Consultamos a Easy!Appointments qué horarios libres hay para este
    // servicio en la fecha elegida, considerando todos los operadores.
    // La función devuelve: { horariosLibres: [...], mapaHorarioOperador: {...} }
    const disponibilidad = await ea.obtenerDisponibilidadServicio(
      servicioElegido.id,
      fechaClave
    );

    let   horariosLibres      = disponibilidad.horariosLibres;
    const mapaHorarioOperador = disponibilidad.mapaHorarioOperador;

    // Guardamos el mapa en memoria temporal para usarlo en CALLBACK C
    // al momento de confirmar la reserva con el operador correcto.
    registrosEnProceso[chatId].mapaHorarioOperador = mapaHorarioOperador;
    registrosEnProceso[chatId].serviceId           = servicioElegido.id;

    // Filtramos los horarios que el vecino ya tiene ocupados en esa fecha,
    // incluyendo cualquier slot que caiga dentro de la duración de una cita existente.
    try {
      const emailFicticio = `dni_${dniActual}@municipio.local`;
      const { citas: citasVecino } = await ea.obtenerCitasDelCliente(emailFicticio);

      // Convierte "HH:MM" a minutos totales desde medianoche para poder
      // comparar rangos numéricos en lugar de strings de hora.
      const toMinutos = (hhmm) => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
      };

      // Para cada cita del vecino en la fecha elegida, calculamos el rango
      // [inicioOcupado, finOcupado) en minutos y descartamos todo slot que caiga dentro.
      const citasEnFecha = citasVecino.filter((cita) => cita.start && cita.start.startsWith(fechaClave));

      if (citasEnFecha.length > 0) {
        const rangosOcupados = citasEnFecha.map((cita) => {
          const horaInicio   = cita.start.substring(11, 16); // "HH:MM"
          const inicioMin    = toMinutos(horaInicio);
          const duracion     = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId)?.duration ?? 30;
          return { inicio: inicioMin, fin: inicioMin + duracion };
        });

        horariosLibres = horariosLibres.filter((slot) => {
          const slotMin = toMinutos(slot);
          return !rangosOcupados.some((r) => slotMin >= r.inicio && slotMin < r.fin);
        });
      }
    } catch (errCitas) {
      // Si la consulta de citas propias falla, continuamos con todos los horarios
      // de EA sin filtrar: es mejor ofrecer un horario potencialmente solapado
      // que dejar al vecino sin opciones por un error secundario.
      logger.error('⚠️ No se pudieron obtener las citas del vecino para filtrar solapamientos:', errCitas.message);
    }

    // Si el array quedó vacío, ningún horario está disponible para esa fecha y trámite.
    if (horariosLibres.length === 0) {

      // Volvemos al selector de semanas para que el vecino elija otra fecha.
      estadosUsuarios[chatId] = 'ESPERANDO_DIA';

      const semanasNoSlots = proximasSemanas(30);
      bot.sendMessage(
        chatId,
        `⚠️ No hay horarios disponibles para *${fechaTexto}* ` +
        `en el trámite de *${tramiteElegido}*.\n\n` +
        `Por favor, elegí otra semana:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: construirBotonesSemanas(semanasNoSlots) },
        }
      );
      return;
    }

    // Si llegamos acá, hay al menos un horario libre.
    // Guardamos la fecha en el registro temporal y avanzamos de estado.
    registrosEnProceso[chatId].fecha = fechaClave;
    estadosUsuarios[chatId] = 'ESPERANDO_HORARIO';

    // Construimos el Inline Keyboard con los horarios libres y el botón de retroceso.
    // El array de filas tiene dos elementos:
    //   - Fila 1: un botón por cada horario disponible, todos en la misma fila horizontal.
    //   - Fila 2: botón de retroceso en su propia fila para que sea bien visible.
    // Agrupamos los horarios de a pares para mostrarlos en filas de 2 columnas.
    // Así son más compactos visualmente sin perder legibilidad.
    const filasHorarios = [];
    for (let i = 0; i < horariosLibres.length; i += 2) {
      const fila = [{ text: `🕐 ${horariosLibres[i]}`, callback_data: `horario_${horariosLibres[i]}` }];
      if (horariosLibres[i + 1]) {
        fila.push({ text: `🕐 ${horariosLibres[i + 1]}`, callback_data: `horario_${horariosLibres[i + 1]}` });
      }
      filasHorarios.push(fila);
    }

    const botonesHorarios = [
      ...filasHorarios,
      [{ text: '⬅️ Volver a elegir fecha', callback_data: 'volver_fechas' }],
    ];

    bot.sendMessage(
      chatId,
      `📅 Fecha elegida: *${fechaTexto}*\n\n🕐 Ahora elegí un horario:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: botonesHorarios },
      }
    );
    return;
  }

  // ==============================================================
  // CALLBACK C: El usuario eligió un HORARIO → mostramos resumen para confirmar
  // ==============================================================
  if (estadoActual === 'ESPERANDO_HORARIO' && data.startsWith('horario_')) {

    const horarioElegido = data.replace('horario_', ''); // ej: "10:00"

    const { dni, nombre, tramite, fecha, serviceId, mapaHorarioOperador } = registrosEnProceso[chatId];

    const fechaObj   = new Date(`${fecha}T12:00:00`);
    const fechaTexto = formatearFechaTexto(fechaObj);

    const providerId = mapaHorarioOperador[horarioElegido];

    const servicioActual = TRAMITES_COMPLETOS.find((s) => s.id === serviceId);
    const duracion       = servicioActual ? servicioActual.duration : 30;

    const [hora, minuto] = horarioElegido.split(':').map(Number);
    const minutosFinales = minuto + duracion;
    const horaFin        = hora + Math.floor(minutosFinales / 60);
    const minutoFin      = minutosFinales % 60;
    const pad            = (n) => String(n).padStart(2, '0');
    const fechaHora      = `${fecha} ${pad(hora)}:${pad(minuto)}:00`;
    const fechaHoraFin   = `${fecha} ${pad(horaFin)}:${pad(minutoFin)}:00`;

    // Guardamos los datos calculados para que CALLBACK C2 los use al confirmar.
    registrosEnProceso[chatId].horario      = horarioElegido;
    registrosEnProceso[chatId].providerId   = providerId;
    registrosEnProceso[chatId].fechaHora    = fechaHora;
    registrosEnProceso[chatId].fechaHoraFin = fechaHoraFin;

    estadosUsuarios[chatId] = 'ESPERANDO_CONFIRMACION';

    bot.sendMessage(
      chatId,
      `¿Confirmás el siguiente turno?\n\n` +
      `👤 *Nombre:* ${nombre}\n` +
      `🪪 *DNI:* ${dni}\n` +
      `📋 *Trámite:* ${tramite}\n` +
      `📅 *Fecha:* ${fechaTexto}\n` +
      `🕐 *Horario:* ${horarioElegido} hs`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Confirmar',  callback_data: 'confirmar_turno'        },
            { text: '❌ Cancelar',   callback_data: 'cancelar_confirmacion'  },
          ]],
        },
      }
    );
    return;
  }

  // ==============================================================
  // CALLBACK C2: El vecino confirmó el turno → creamos la cita en EA
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CONFIRMACION' && data === 'confirmar_turno') {

    const { dni, nombre, tramite, fecha, serviceId,
            horario: horarioElegido, providerId,
            fechaHora, fechaHoraFin } = registrosEnProceso[chatId];

    const fechaTexto     = formatearFechaTexto(new Date(`${fecha}T12:00:00`));
    const esModificacion = registrosEnProceso[chatId].esModificacion === true;

    logger.info('📤 Datos enviados a EA:', JSON.stringify({
      serviceId, providerId, nombre, dni,
      email: `dni_${dni}@municipio.local`,
      fechaHora, fechaHoraFin,
    }));

    try {
      const citaCreada = await ea.crearCita({
        serviceId,
        providerId,
        nombre,
        apellido:    '',
        dni,
        email:       `dni_${dni}@municipio.local`,
        fechaHora,
        fechaHoraFin,
        notas:       `DNI: ${dni} | Trámite: ${tramite}`,
      });
      logger.info('📥 Respuesta de EA:', JSON.stringify(citaCreada));
    } catch (error) {
      logger.error(`❌ Error al crear cita en EA para DNI ${dni}:`, error.message);
      bot.sendMessage(
        chatId,
        '⚠️ Hubo un problema al confirmar tu turno. Es posible que ese horario haya sido tomado en este momento.\n\n' +
        'Escribí *Menu* para volver al inicio y elegir otro horario.',
        { parse_mode: 'Markdown' }
      );
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      gestionarTimeout(chatId);
      return;
    }

    logger.info(`💾 Turno registrado en EA: ${nombre} (DNI: ${dni}) → ${tramite} | ${fechaTexto} ${horarioElegido}`);

    const encabezadoConfirmacion = esModificacion
      ? '✏️ *¡Tu turno fue modificado correctamente!*'
      : '✅ *¡Tu turno quedó confirmado!*';

    const pieConfirmacion = esModificacion
      ? 'Te esperamos. ¡Hasta pronto!'
      : 'Tu turno quedó registrado en el sistema. Te esperamos. ¡Hasta pronto!';

    bot.sendMessage(
      chatId,
      `${encabezadoConfirmacion}\n\n` +
      `👤 *Nombre:* ${nombre}\n` +
      `🪪 *DNI:* ${dni}\n` +
      `📋 *Trámite:* ${tramite}\n` +
      `📅 *Fecha:* ${fechaTexto}\n` +
      `🕐 *Horario:* ${horarioElegido} hs\n\n` +
      pieConfirmacion,
      { parse_mode: 'Markdown' }
    );

    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'INICIAL';
    gestionarTimeout(chatId);
    return;
  }

  // ==============================================================
  // CALLBACK C3: El vecino canceló la confirmación → volver al selector de semanas
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CONFIRMACION' && data === 'cancelar_confirmacion') {

    // Eliminamos los datos del horario calculado pero conservamos el contexto
    // del trámite y del vecino para que pueda elegir otro día sin empezar de cero.
    delete registrosEnProceso[chatId].horario;
    delete registrosEnProceso[chatId].providerId;
    delete registrosEnProceso[chatId].fechaHora;
    delete registrosEnProceso[chatId].fechaHoraFin;
    delete registrosEnProceso[chatId].fecha;

    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    const semanasC3 = proximasSemanas(30);
    bot.sendMessage(
      chatId,
      '📅 Entendido. Elegí una nueva semana para tu turno:',
      { reply_markup: { inline_keyboard: construirBotonesSemanas(semanasC3) } }
    );
    return;
  }

  // ==============================================================
  // CALLBACK D: El usuario quiere volver a elegir la FECHA
  // ==============================================================
  if (estadoActual === 'ESPERANDO_HORARIO' && data === 'volver_fechas') {

    // Eliminamos la fecha guardada provisionalmente en el registro temporal.
    // Si no la borramos y el usuario elige una fecha diferente, el dato viejo
    // podría quedar huérfano y causar inconsistencias en pasos posteriores.
    delete registrosEnProceso[chatId].fecha;

    // Retrocedemos al selector de semanas; el trámite y el nombre siguen guardados.
    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    const semanasD = proximasSemanas(30);
    bot.sendMessage(
      chatId,
      '📅 Elegí una semana para tu turno:',
      { reply_markup: { inline_keyboard: construirBotonesSemanas(semanasD) } }
    );
    return;
  }

  // ==============================================================
  // CALLBACK E0: El usuario eligió "Finalizar" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'finalizar_sesion') {

    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'INICIAL';
    gestionarTimeout(chatId);

    bot.sendMessage(
      chatId,
      '¡Hasta luego! Si necesitás algo más, escribí *Menu* cuando quieras.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ==============================================================
  // CALLBACK E: El usuario eligió "Nuevo Trámite" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'nuevo_tramite') {

    const dniEnProceso = registrosEnProceso[chatId].dni;

    // Consultamos EA para saber qué trámites ya tiene reservados este vecino.
    // No podemos confiar en el JSON porque las citas ahora viven en EA.
    let citasActivasE;
    try {
      citasActivasE = await ea.obtenerCitasDelCliente(`dni_${dniEnProceso}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al obtener citas para nuevo trámite (DNI ${dniEnProceso}):`, error.message);
      bot.sendMessage(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    // Construimos un Set con los nombres de los trámites que el vecino ya tiene activos.
    // Usamos Set porque has() es más eficiente que includes() para búsquedas repetidas.
    // Convertimos serviceId → nombre usando TRAMITES_COMPLETOS para poder comparar
    // contra el array TRAMITES[], que trabaja con nombres (no con IDs numéricos).
    const tramitesActivos = new Set();
    (citasActivasE.citas || []).forEach((cita) => {
      const servicio = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
      if (servicio) tramitesActivos.add(servicio.name);
    });

    // Filtramos los índices de TRAMITES conservando solo los que el usuario
    // todavía NO tiene activos. El proceso tiene tres pasos encadenados:
    //   1. map()    → asociamos cada trámite con su índice original { nombre, i }
    //   2. filter() → descartamos los trámites cuyo nombre esté en tramitesActivos
    //   3. map()    → nos quedamos únicamente con el número de índice
    // Preservar el índice original es obligatorio porque callback_data lo usa.
    const indicesDisponibles = TRAMITES
      .map((nombre, i) => ({ nombre, i }))
      .filter(({ nombre }) => !tramitesActivos.has(nombre))
      .map(({ i }) => i);

    // Si el array quedó vacío, el usuario ya cubrió todos los trámites disponibles.
    // NO cambiamos el estado ni mostramos botones: solo enviamos el aviso informativo
    // y lo dejamos en MENU_GESTION para que pueda elegir otra acción.
    if (indicesDisponibles.length === 0) {
      bot.sendMessage(
        chatId,
        '⚠️ Ya tenés turnos activos para todos los trámites disponibles.'
      );
      return;
    }

    // Hay al menos un trámite libre: avanzamos el estado a ESPERANDO_TRAMITE
    // y le mostramos solo los botones de los trámites que todavía puede reservar.
    estadosUsuarios[chatId] = 'ESPERANDO_TRAMITE';

    // Pasamos los índices filtrados a teclasMenuTramites() para que construya
    // únicamente los botones correspondientes a los trámites disponibles.
    bot.sendMessage(
      chatId,
      '📋 ¿Qué trámite querés agregar?',
      { reply_markup: { inline_keyboard: teclasMenuTramites(indicesDisponibles) } }
    );
    return;
  }

  // ==============================================================
  // CALLBACK F: El usuario eligió "Modificar Turno" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'modificar_turno') {

    // Cambiamos el estado para identificar que los próximos callbacks de este
    // usuario corresponden a la selección de qué turno quiere modificar.
    estadosUsuarios[chatId] = 'ESPERANDO_MODIFICACION';

    const dniModificacion = registrosEnProceso[chatId].dni;

    // Consultamos EA para obtener las citas actuales del vecino.
    let citasModificacion;
    try {
      citasModificacion = await ea.obtenerCitasDelCliente(`dni_${dniModificacion}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al obtener citas para modificar (DNI ${dniModificacion}):`, error.message);
      estadosUsuarios[chatId] = 'MENU_GESTION';
      bot.sendMessage(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    // Si no hay citas activas, no hay nada que modificar.
    if (!citasModificacion || citasModificacion.citas.length === 0) {

      estadosUsuarios[chatId] = 'MENU_GESTION';
      bot.sendMessage(chatId, '⚠️ No tenés turnos activos para modificar.');
      return;
    }

    // Guardamos la lista de citas en memoria temporal para que CALLBACK F2
    // pueda identificar la cita elegida por su ID sin re-consultar EA.
    registrosEnProceso[chatId].citasModificacion = citasModificacion.citas;


    // Construimos el Inline Keyboard: una fila por cada cita activa.
    // IMPORTANTE: usamos cita.id (ID real de EA) en el callback_data, no el índice
    // del array. Al confirmar, necesitamos ese ID para llamar a cancelarCita().
    const botonesEditar = citasModificacion.citas.map((cita) => {

      const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
      const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
      const fechaTexto    = formatearFechaTexto(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
      const horario       = cita.start.substring(11, 16);

      return [{
        text: `✏️ ${tramiteNombre} — ${fechaTexto} ${horario} hs`,
        callback_data: `editar_${cita.id}`,
      }];
    });

    // Agregamos al final el botón de retroceso en su propia fila.
    botonesEditar.push([{ text: '⬅️ Volver al menú', callback_data: 'volver_menu_gestion' }]);

    bot.sendMessage(
      chatId,
      '¿Qué turno necesitás modificar?',
      { reply_markup: { inline_keyboard: botonesEditar } }
    );
    return;
  }

  // ==============================================================
  // CALLBACK F2: El usuario eligió qué turno editar (botón "editar_N")
  // ==============================================================
  if (estadoActual === 'ESPERANDO_MODIFICACION' && data.startsWith('editar_')) {

    // Extraemos el ID de la cita en EA desde el callback_data (ej: "editar_47" → 47).
    // Este ID fue puesto por CALLBACK F al armar los botones; no es un índice de array
    // sino el identificador real que necesita cancelarCita() para liberar el cupo.
    const appointmentId = parseInt(data.replace('editar_', ''), 10);

    if (isNaN(appointmentId)) {
      bot.sendMessage(chatId, '⚠️ Ocurrió un error al procesar la selección. Intentá de nuevo.');
      return;
    }

    // Buscamos la cita en la lista que CALLBACK F guardó en memoria temporal.
    const citasModificacion = registrosEnProceso[chatId].citasModificacion || [];
    const citaAEditar       = citasModificacion.find((c) => c.id === appointmentId);

    // Si no se encuentra (botón desactualizado, sesión renovada, etc.), abortamos.
    if (!citaAEditar) {
      bot.sendMessage(chatId, '⚠️ Ese turno ya no existe o la sesión expiró. Ingresá tu DNI para volver al menú.');
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    // Obtenemos el nombre del trámite a partir del serviceId de la cita.
    // Lo guardamos en registrosEnProceso para que el flujo de fecha/horario
    // sepa qué servicio está en proceso, igual que en el flujo de turno nuevo.
    const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === citaAEditar.serviceId);
    const tramiteAEditar = servicio ? servicio.name : `Servicio ${citaAEditar.serviceId}`;
    registrosEnProceso[chatId].tramite = tramiteAEditar;

    // Bandera que le indica a CALLBACK C que este flujo es una modificación
    // y no un turno nuevo; diferencia el mensaje de confirmación final.
    registrosEnProceso[chatId].esModificacion = true;

    const dniEditar = registrosEnProceso[chatId].dni;

    // LIBERACIÓN DEL CUPO: cancelamos la cita vieja en EA ANTES de pedir la nueva fecha.
    // Si no lo hacemos primero, el cupo que ocupa esta cita aparecería como "tomado"
    // al consultar disponibilidad, impidiéndole al vecino reservar el mismo horario.
    try {
      await ea.cancelarCita(appointmentId);
    } catch (error) {
      logger.error(`❌ Error al liberar cita ${appointmentId} para modificar (DNI ${dniEditar}):`, error.message);
      bot.sendMessage(
        chatId,
        '⚠️ No pudimos liberar tu turno anterior. Por favor, intentá de nuevo.'
      );
      return;
    }

    logger.info(`✏️  Turno a modificar liberado en EA: DNI ${dniEditar} → cita ${appointmentId} (${tramiteAEditar})`);

    // Avanzamos al selector de semanas: el flujo de fecha y horario es el mismo
    // que cuando se saca un turno nuevo; no hace falta duplicar esa lógica.
    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    const semanasE = proximasSemanas(30);
    bot.sendMessage(
      chatId,
      `Turno anterior liberado. 📅 Elegí la nueva semana para tu trámite de *${tramiteAEditar}*:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: construirBotonesSemanas(semanasE) },
      }
    );
    return;
  }

  // ==============================================================
  // CALLBACK F3: El usuario se arrepintió desde la pantalla de modificación
  // ==============================================================
  if (data === 'volver_menu_gestion') {

    const dniVolver = registrosEnProceso[chatId]?.dni;

    if (!dniVolver) {
      estadosUsuarios[chatId] = 'ESPERANDO_DNI';
      bot.sendMessage(chatId, 'La sesión expiró. Por favor, ingresá tu DNI para volver al menú.');
      return;
    }

    let citasVolver;
    try {
      citasVolver = await ea.obtenerCitasDelCliente(`dni_${dniVolver}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas al volver al menú (DNI ${dniVolver}):`, error.message);
      bot.sendMessage(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    const nombreVolver = citasVolver.nombreCliente || registrosEnProceso[chatId].nombre || 'vecino/a';
    const citasV       = citasVolver.citas ?? [];

    const textoMenuV = citasV.length > 0
      ? `👋 Hola *${nombreVolver}*, estos son tus turnos activos:\n\n` +
        citasV.map((cita, i) => {
          const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
          const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
          const fechaTexto    = formatearFechaTexto(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
          const horario       = cita.start.substring(11, 16);
          return `  *${i + 1}.* ${tramiteNombre} — ${fechaTexto} a las ${horario} hs`;
        }).join('\n') + '\n\n¿Qué querés hacer?'
      : `👋 Hola *${nombreVolver}*, no tenés turnos activos por el momento.\n\n¿Qué querés hacer?`;

    registrosEnProceso[chatId].nombre = nombreVolver;
    estadosUsuarios[chatId] = 'MENU_GESTION';

    bot.sendMessage(chatId, textoMenuV, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: construirTecladoGestion(citasV.length > 0) },
    });
    return;
  }

  // ==============================================================
  // CALLBACK G: El usuario eligió "Cancelar Turno" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'cancelar_turno') {

    // Cambiamos el estado para que los próximos callbacks de este usuario
    // sean interpretados como una selección dentro del flujo de cancelación.
    estadosUsuarios[chatId] = 'ESPERANDO_CANCELACION';

    const dniCancelacion = registrosEnProceso[chatId].dni;

    // Consultamos EA para obtener las citas actuales del vecino.
    let citasCancelacion;
    try {
      citasCancelacion = await ea.obtenerCitasDelCliente(`dni_${dniCancelacion}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al obtener citas para cancelar (DNI ${dniCancelacion}):`, error.message);
      estadosUsuarios[chatId] = 'MENU_GESTION';
      bot.sendMessage(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    // Si no hay citas activas, no hay nada para cancelar.
    if (!citasCancelacion || citasCancelacion.citas.length === 0) {
      estadosUsuarios[chatId] = 'MENU_GESTION';
      bot.sendMessage(chatId, '⚠️ No tenés turnos activos para cancelar.');
      return;
    }

    // Guardamos la lista de citas en memoria temporal para que CALLBACK H
    // pueda leer los datos del turno (tramite, fecha, horario) sin re-consultar EA.
    // La clave es el ID de la cita en EA, que también viaja en el callback_data del botón.
    registrosEnProceso[chatId].citasCancelacion = citasCancelacion.citas;

    // Construimos el Inline Keyboard dinámico: una fila por cada cita activa.
    // IMPORTANTE: el callback_data usa el ID real de EA (cita.id), NO el índice
    // del array. Esto es necesario porque cancelarCita() requiere el ID de EA,
    // no una posición relativa que puede cambiar entre consultas.
    const botonesTurnos = citasCancelacion.citas.map((cita) => {
      // Convertimos el formato de EA al texto legible para el botón.
      const servicio     = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
      const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
      const fechaTexto   = formatearFechaTexto(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
      const horario      = cita.start.substring(11, 16);

      return [{
        text: `❌ ${tramiteNombre} — ${fechaTexto} ${horario} hs`,
        callback_data: `borrar_${cita.id}`,
      }];
    });

    // Agregamos al final una fila con el botón de retroceso.
    botonesTurnos.push([{ text: '⬅️ Volver al menú', callback_data: 'volver_menu' }]);

    bot.sendMessage(
      chatId,
      'Seleccioná el turno que deseás cancelar:',
      { reply_markup: { inline_keyboard: botonesTurnos } }
    );
    return;
  }

  // ==============================================================
  // CALLBACK H: El usuario eligió qué turno borrar → mostramos resumen para confirmar
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CANCELACION' && data.startsWith('borrar_')) {

    const appointmentId = parseInt(data.replace('borrar_', ''), 10);

    if (isNaN(appointmentId)) {
      bot.sendMessage(chatId, '⚠️ Ocurrió un error al procesar la selección. Intentá de nuevo.');
      return;
    }

    const citasCancelacion = registrosEnProceso[chatId].citasCancelacion || [];
    const citaACancelar    = citasCancelacion.find((c) => c.id === appointmentId);

    if (!citaACancelar) {
      bot.sendMessage(chatId, '⚠️ Ese turno ya no existe o la sesión expiró. Ingresá tu DNI para volver al menú.');
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    const servicio         = TRAMITES_COMPLETOS.find((s) => s.id === citaACancelar.serviceId);
    const tramiteCancelado = servicio ? servicio.name : `Servicio ${citaACancelar.serviceId}`;
    const fechaCancelada   = formatearFechaTexto(new Date(`${citaACancelar.start.substring(0, 10)}T12:00:00`));
    const horarioCancelado = citaACancelar.start.substring(11, 16);
    const dniBorrar        = registrosEnProceso[chatId].dni;

    // Guardamos los datos de la cita a cancelar para que CALLBACK H2 los use al confirmar.
    registrosEnProceso[chatId].citaAConfirmarCancelacion = {
      appointmentId, tramiteCancelado, fechaCancelada, horarioCancelado, dniBorrar,
    };
    estadosUsuarios[chatId] = 'ESPERANDO_CONFIRMACION_CANCELACION';

    bot.sendMessage(
      chatId,
      `¿Confirmás la cancelación del siguiente turno?\n\n` +
      `📋 *Trámite:* ${tramiteCancelado}\n` +
      `📅 *Fecha:* ${fechaCancelada}\n` +
      `🕐 *Horario:* ${horarioCancelado} hs`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Confirmar cancelación', callback_data: 'confirmar_cancelacion' },
            { text: '🔙 Volver al menú',        callback_data: 'volver_menu'           },
          ]],
        },
      }
    );
    return;
  }

  // ==============================================================
  // CALLBACK H2: El vecino confirmó la cancelación → eliminamos la cita en EA
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CONFIRMACION_CANCELACION' && data === 'confirmar_cancelacion') {

    const { appointmentId, tramiteCancelado, fechaCancelada, horarioCancelado, dniBorrar }
      = registrosEnProceso[chatId].citaAConfirmarCancelacion;

    try {
      await ea.cancelarCita(appointmentId);
    } catch (error) {
      logger.error(`❌ Error al cancelar cita ${appointmentId} para DNI ${dniBorrar}:`, error.message);
      bot.sendMessage(
        chatId,
        '⚠️ No pudimos cancelar el turno en este momento. Por favor, intentá de nuevo.'
      );
      return;
    }

    logger.info(`🗑️  Turno cancelado en EA: DNI ${dniBorrar} → ${tramiteCancelado} | ${fechaCancelada} ${horarioCancelado}`);

    // Limpiamos el objeto de confirmación pero mantenemos el DNI para que
    // volver_menu_post_cancelacion pueda relanzar el menú sin pedirlo de nuevo.
    delete registrosEnProceso[chatId].citaAConfirmarCancelacion;
    estadosUsuarios[chatId] = 'INICIAL';

    bot.sendMessage(
      chatId,
      `❌ Cancelaste exitosamente el turno de *${tramiteCancelado}* ` +
      `del *${fechaCancelada}* a las *${horarioCancelado}* hs.\n\n` +
      `Si necesitás hacer algo más, usá el botón de abajo.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Volver al menú', callback_data: 'volver_menu_post_cancelacion' }],
          ],
        },
      }
    );
    return;
  }

  // ==============================================================
  // CALLBACK I: El usuario tocó "Volver al menú" tras cancelar un turno
  // ==============================================================
  if (data === 'volver_menu_post_cancelacion') {

    const dniPostCancel = registrosEnProceso[chatId]?.dni;

    // Si por alguna razón el DNI ya no está en memoria, pedimos que lo reingrese.
    if (!dniPostCancel) {
      estadosUsuarios[chatId] = 'ESPERANDO_DNI';
      bot.sendMessage(chatId, 'La sesión expiró. Por favor, ingresá tu DNI para volver al menú.');
      return;
    }

    // Consultamos EA con el DNI que ya tenemos en memoria para mostrar la
    // lista de turnos actualizada (sin el turno recién cancelado).
    let citasPostCancel;
    try {
      citasPostCancel = await ea.obtenerCitasDelCliente(`dni_${dniPostCancel}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas post-cancelación (DNI ${dniPostCancel}):`, error.message);
      bot.sendMessage(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    const nombre = citasPostCancel.nombreCliente || registrosEnProceso[chatId].nombre || 'vecino/a';

    let textoMenu;
    if (citasPostCancel.citas && citasPostCancel.citas.length > 0) {

      const listaTurnos = citasPostCancel.citas.map((cita) => {
        const servicio     = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
        const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
        const fechaISO     = cita.start.substring(0, 10);
        const fechaTexto   = formatearFechaTexto(new Date(`${fechaISO}T12:00:00`));
        const horario      = cita.start.substring(11, 16);
        return { tramiteNombre, fechaTexto, horario };
      });

      const renglonesTurnos = listaTurnos.map((t, i) =>
        `  *${i + 1}.* ${t.tramiteNombre} — ${t.fechaTexto} a las ${t.horario} hs`
      );

      textoMenu =
        `👋 Hola *${nombre}*, estos son tus turnos activos:\n\n` +
        renglonesTurnos.join('\n') +
        '\n\n¿Qué querés hacer?';

    } else {
      textoMenu =
        `👋 Hola *${nombre}*, no tenés turnos activos por el momento.\n\n¿Qué querés hacer?`;
    }

    // Actualizamos el nombre en memoria por si el vecino era nuevo y aún no lo teníamos.
    registrosEnProceso[chatId].nombre = nombre;
    estadosUsuarios[chatId] = 'MENU_GESTION';

    const tecladoGestion = construirTecladoGestion(citasPostCancel.citas.length > 0);

    bot.sendMessage(chatId, textoMenu, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: tecladoGestion },
    });
    return;
  }

  // ==============================================================
  // CALLBACK J: El usuario tocó "Volver al menú" desde otra pantalla
  // ==============================================================
  if (data === 'volver_menu') {

    const dniMenu = registrosEnProceso[chatId]?.dni;

    if (!dniMenu) {
      estadosUsuarios[chatId] = 'ESPERANDO_DNI';
      bot.sendMessage(chatId, 'La sesión expiró. Por favor, ingresá tu DNI para volver al menú.');
      return;
    }

    let citasMenu;
    try {
      citasMenu = await ea.obtenerCitasDelCliente(`dni_${dniMenu}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas al volver al menú (DNI ${dniMenu}):`, error.message);
      bot.sendMessage(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    const nombreMenu = citasMenu.nombreCliente || registrosEnProceso[chatId].nombre || 'vecino/a';
    const citasM     = citasMenu.citas ?? [];

    const textoMenuM = citasM.length > 0
      ? `👋 Hola *${nombreMenu}*, estos son tus turnos activos:\n\n` +
        citasM.map((cita, i) => {
          const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
          const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
          const fechaTexto    = formatearFechaTexto(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
          const horario       = cita.start.substring(11, 16);
          return `  *${i + 1}.* ${tramiteNombre} — ${fechaTexto} a las ${horario} hs`;
        }).join('\n') + '\n\n¿Qué querés hacer?'
      : `👋 Hola *${nombreMenu}*, no tenés turnos activos por el momento.\n\n¿Qué querés hacer?`;

    registrosEnProceso[chatId].nombre = nombreMenu;
    estadosUsuarios[chatId] = 'MENU_GESTION';

    bot.sendMessage(chatId, textoMenuM, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: construirTecladoGestion(citasM.length > 0) },
    });
    return;
  }
});

// ---------------------------------------------------------------
// 13. MANEJO DE ERRORES DE POLLING
// ---------------------------------------------------------------
bot.on('polling_error', (error) => {
  logger.error('❌ Error de conexión con Telegram:', error.message);
});
