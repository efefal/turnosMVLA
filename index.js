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
    console.error('Error al leer el archivo de usuarios:', error);
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
    console.error('Error al guardar en el archivo de usuarios:', error);
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
    console.log(`✅ Trámites cargados: ${TRAMITES.join(', ')}`);
  } catch (error) {
    console.error('❌ Error al cargar trámites desde Easy!Appointments:', error.message);
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
// ---------------------------------------------------------------
// 6. VALIDAR Y OBTENER EL TOKEN
// ---------------------------------------------------------------
const token = process.env.TELEGRAM_TOKEN;

if (!token) {
  console.error('❌ Error: No se encontró TELEGRAM_TOKEN en el archivo .env');
  process.exit(1);
}

// ---------------------------------------------------------------
// 7. CREAR LA INSTANCIA DEL BOT
// ---------------------------------------------------------------
const bot = new TelegramBot(token, { polling: true });

console.log('✅ Bot iniciado correctamente. Esperando mensajes...');
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
//   - 'ESPERANDO_FECHA'       → Trámite elegido; mostramos fechas por Inline Keyboard.
//   - 'ESPERANDO_HORARIO'     → Fecha elegida; mostramos horarios por Inline Keyboard.
//   - 'ESPERANDO_CANCELACION'  → Mostramos los turnos activos para que elija cuál borrar.
//   - 'ESPERANDO_MODIFICACION' → Mostramos los turnos activos para que elija cuál modificar.
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

// Detecta si el texto es un saludo común.
function esSaludo(texto) {
  const saludos = ['hola', 'buenas', 'buen dia', 'buen día', 'buenos dias', 'buenos días'];
  const textoNormalizado = texto.toLowerCase().trim();
  return saludos.some((saludo) => textoNormalizado.includes(saludo));
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
  return indices.map((i) => ([{
    text: TRAMITES[i],
    callback_data: `tramite_${i}`,
  }]));
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
      console.error(`Error al enviar mensaje de timeout al usuario ${chatId}:`, error);
    }
  }, 600000);
}

// ---------------------------------------------------------------
// 11. MANEJADOR PRINCIPAL DE MENSAJES
// ---------------------------------------------------------------
// Toda la lógica conversacional vive en este único bloque.
// El evento 'message' se dispara con cada mensaje que llega al bot.
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const texto = msg.text;

  // Ignoramos mensajes sin texto (fotos, stickers, archivos, etc.)
  if (!texto) return;

  // Reiniciamos (o cancelamos) el temporizador de inactividad con cada mensaje.
  // Si el usuario está en INICIAL no se crea timeout; en cualquier otro estado
  // el reloj se reinicia desde cero para darle 10 minutos más de sesión activa.
  gestionarTimeout(chatId);

  // Obtenemos el estado actual del usuario (INICIAL si es la primera vez)
  const estadoActual = estadosUsuarios[chatId] || 'INICIAL';

  console.log(`📩 ${msg.chat.first_name} (${chatId}) | Estado: ${estadoActual} | Texto: "${texto}"`);

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
        'Debe tener entre 7 y 8 números, sin letras ni espacios.\n' +
        'Por favor, intentá de nuevo.'
      );
      return; // Mantenemos el estado ESPERANDO_DNI para reintento
    }

    const dniIngresado = texto.trim();
    const usuarioEncontrado = buscarUsuarioPorDni(dniIngresado);

    // B2: El usuario YA EXISTE en la base de datos → mostramos el menú de gestión.
    // Este bloque unifica el tratamiento de usuarios con y sin turnos activos.
    if (usuarioEncontrado) {
      const { nombre } = usuarioEncontrado;

      // Leemos directamente el array turnos[] del usuario.
      // Todos los registros usan este formato; si el usuario no tiene turnos aún,
      // el array existe vacío porque así lo creamos al registrarlo por primera vez.
      const listaTurnos = usuarioEncontrado.turnos || [];

      // Armamos el cuerpo del mensaje. Si tiene turnos los listamos; si no, informamos.
      let textoBienvenida;
      if (listaTurnos.length > 0) {
        // map() convierte cada turno en un renglón de texto numerado y formateado.
        // Todos los registros tienen los campos tramite, fecha y horario garantizados.
        const renglonesTurnos = listaTurnos.map((t, i) => {
          return `  *${i + 1}.* ${t.tramite} — ${t.fecha} a las ${t.horario} hs`;
        });
        // join() une todos los renglones con salto de línea para armar el bloque.
        textoBienvenida =
          `👋 Hola *${nombre}*, estos son tus turnos activos:\n\n` +
          renglonesTurnos.join('\n') +
          '\n\n¿Qué querés hacer?';
      } else {
        textoBienvenida =
          `👋 Hola *${nombre}*, actualmente no tenés turnos activos.\n\n¿Qué querés hacer?`;
      }

      // Guardamos DNI y nombre en memoria temporal anticipadamente.
      // Si el usuario elige "Nuevo Trámite", ya tenemos sus datos sin tener
      // que volver a pedirlos; el flujo salta directo a la selección de trámite.
      registrosEnProceso[chatId] = { dni: dniIngresado, nombre: nombre };

      // Cambiamos el estado a MENU_GESTION para identificar que los próximos
      // callbacks de este usuario provienen de los botones del menú.
      estadosUsuarios[chatId] = 'MENU_GESTION';

      // Construimos el Inline Keyboard con las 3 acciones disponibles.
      // Cada botón ocupa su propia fila para mayor claridad visual.
      const tecladoGestion = [
        [{ text: '➕ Nuevo Trámite',   callback_data: 'nuevo_tramite'   }],
        [{ text: '✏️ Modificar Turno', callback_data: 'modificar_turno' }],
        [{ text: '❌ Cancelar Turno',  callback_data: 'cancelar_turno'  }],
      ];

      bot.sendMessage(chatId, textoBienvenida, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: tecladoGestion },
      });
      return;
    }

    // B2c: El DNI NO existe en la base de datos → iniciamos el registro
    // Guardamos el DNI en memoria temporal para usarlo al final del registro
    registrosEnProceso[chatId] = { dni: dniIngresado };
    estadosUsuarios[chatId] = 'ESPERANDO_NOMBRE';

    bot.sendMessage(
      chatId,
      'No encontramos registros para tu DNI. Vamos a registrarte.\n' +
      'Por favor, ingresá tu Nombre y Apellido:'
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
      `Gracias, ${nombreIngresado}. ¿Qué trámite deseás realizar?`,
      { reply_markup: { inline_keyboard: teclasMenuTramites() } }
    );
    return;
  }

  // ==============================================================
  // RAMA D: Mensaje fuera de contexto (estado INICIAL, sin saludo)
  // Nota: la selección de trámite se realiza ahora mediante botones
  // (Inline Keyboard) y se procesa en el manejador callback_query.
  // ==============================================================
  bot.sendMessage(
    chatId,
    'No entendí ese mensaje. Escribí "hola" o usá el comando /start para comenzar.'
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
    estadosUsuarios[chatId] = 'ESPERANDO_FECHA';

    // Construimos el Inline Keyboard con los próximos 3 días hábiles.
    // Cada botón lleva como callback_data la clave "fecha_YYYY-MM-DD".
    const diasHabilesT = proximosDiasHabiles(3);
    const botonesFechasT = diasHabilesT.map((dia) => ([{
      text: formatearFechaTexto(dia),
      callback_data: `fecha_${formatearFechaClave(dia)}`,
    }]));

    bot.sendMessage(
      chatId,
      `📋 Trámite elegido: *${TRAMITES[indice]}*\n\n📅 Ahora elegí una fecha:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: botonesFechasT },
      }
    );
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

    const horariosLibres      = disponibilidad.horariosLibres;
    const mapaHorarioOperador = disponibilidad.mapaHorarioOperador;

    // Guardamos el mapa en memoria temporal para usarlo en CALLBACK C
    // al momento de confirmar la reserva con el operador correcto.
    registrosEnProceso[chatId].mapaHorarioOperador = mapaHorarioOperador;
    registrosEnProceso[chatId].serviceId           = servicioElegido.id;

    // Si el array quedó vacío, ningún horario está disponible para esa fecha y trámite.
    if (horariosLibres.length === 0) {

      // Recalculamos las fechas hábiles para volver a mostrar el teclado de selección.
      const diasHabiles = proximosDiasHabiles(3);
      const botonesFechas = diasHabiles.map((dia) => ([{
        text: formatearFechaTexto(dia),
        callback_data: `fecha_${formatearFechaClave(dia)}`,
      }]));

      // Mantenemos el estado en ESPERANDO_FECHA para que el usuario pueda
      // elegir otra fecha sin tener que reiniciar todo el flujo.
      estadosUsuarios[chatId] = 'ESPERANDO_FECHA';

      bot.sendMessage(
        chatId,
        `⚠️ No hay horarios disponibles para *${fechaTexto}* ` +
        `en el trámite de *${tramiteElegido}*.\n\n` +
        `Por favor, elegí otra fecha:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: botonesFechas },
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
  // CALLBACK C: El usuario eligió un HORARIO → guardamos todo
  // ==============================================================
  if (estadoActual === 'ESPERANDO_HORARIO' && data.startsWith('horario_')) {

    const horarioElegido = data.replace('horario_', ''); // ej: "10:00"

    // Ahora tomamos también serviceId y mapaHorarioOperador, que CALLBACK B
    // guardó en registrosEnProceso cuando consultó la disponibilidad.
    const { dni, nombre, tramite, fecha, serviceId, mapaHorarioOperador } = registrosEnProceso[chatId];

    // Formateamos la fecha para el mensaje de confirmación al vecino.
    const fechaObj = new Date(`${fecha}T12:00:00`);
    const fechaTexto = formatearFechaTexto(fechaObj);

    // El mapa horario→operador nos dice a quién asignar este turno sin
    // que el vecino haya tenido que elegir operador explícitamente.
    const providerId = mapaHorarioOperador[horarioElegido];

    // Buscamos la duración del servicio en TRAMITES_COMPLETOS para calcular
    // la hora de fin. EA lo recalcula internamente, pero su API lo requiere
    // en el cuerpo del POST. Si por alguna razón no encontramos el servicio,
    // usamos 30 minutos como valor de respaldo.
    const servicioActual = TRAMITES_COMPLETOS.find((s) => s.id === serviceId);
    const duracion = servicioActual ? servicioActual.duration : 30;

    // Armamos los strings de inicio y fin en el formato que espera EA: "YYYY-MM-DD HH:MM:SS"
    // Dividimos horarioElegido en hora y minuto para poder sumar la duración correctamente.
    const [hora, minuto] = horarioElegido.split(':').map(Number);
    const minutosFinales = minuto + duracion;
    const horaFin   = hora + Math.floor(minutosFinales / 60); // sube una hora si los minutos pasan de 59
    const minutoFin = minutosFinales % 60;
    const pad = (n) => String(n).padStart(2, '0'); // convierte 9 → "09"
    const fechaHora    = `${fecha} ${pad(hora)}:${pad(minuto)}:00`;
    const fechaHoraFin = `${fecha} ${pad(horaFin)}:${pad(minutoFin)}:00`;

    // Leemos la bandera ANTES del try/catch porque la necesitamos para el
    // mensaje de confirmación y no queremos acceder a registrosEnProceso
    // después de haberlo limpiado en el bloque finally implícito.
    const esModificacion = registrosEnProceso[chatId].esModificacion === true;

    // Creamos la cita en Easy!Appointments.
    // El email ficticio con el DNI es la clave que luego usamos para buscar
    // los turnos del vecino con obtenerCitasDelCliente().
    try {
      await ea.crearCita({
        serviceId,
        providerId,
        nombre,
        apellido:    '',        // el vecino ingresa nombre completo en un solo campo
        dni,
        email:       `dni_${dni}@municipio.local`,
        fechaHora,
        fechaHoraFin,
        notas:       `DNI: ${dni} | Trámite: ${tramite}`,
      });
    } catch (error) {
      // Si EA rechaza la cita (API caída, cupo tomado en el mientras, etc.),
      // avisamos al vecino y reseteamos el estado para que empiece de nuevo.
      console.error(`❌ Error al crear cita en EA para DNI ${dni}:`, error.message);
      bot.sendMessage(
        chatId,
        '⚠️ Hubo un problema al confirmar tu turno. Por favor, escribí /start e intentá de nuevo.'
      );
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      gestionarTimeout(chatId);
      return;
    }

    console.log(`💾 Turno registrado en EA: ${nombre} (DNI: ${dni}) → ${tramite} | ${fechaTexto} ${horarioElegido}`);

    // Elegimos el encabezado del mensaje según el origen del flujo.
    // El operador ternario devuelve uno u otro string sin repetir el resto del mensaje.
    const encabezadoConfirmacion = esModificacion
      ? '✏️ *¡Tu turno fue modificado correctamente!*'
      : '✅ *¡Tu turno quedó confirmado!*';

    bot.sendMessage(
      chatId,
      `${encabezadoConfirmacion}\n\n` +
      `👤 *Nombre:* ${nombre}\n` +
      `🪪 *DNI:* ${dni}\n` +
      `📋 *Trámite:* ${tramite}\n` +
      `📅 *Fecha:* ${fechaTexto}\n` +
      `🕐 *Horario:* ${horarioElegido} hs\n\n` +
      `Te esperamos. ¡Hasta pronto!`,
      { parse_mode: 'Markdown' }
    );

    // Limpiamos memoria temporal (incluida la bandera) y reiniciamos estado.
    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'INICIAL';

    // Cancelamos el timeout que se creó al inicio de este callback.
    // gestionarTimeout() fue llamado antes de que el estado cambiara a INICIAL,
    // así que en ese momento creó un temporizador de 10 minutos. Si no lo
    // cancelamos ahora, se dispararía igual y le llegaría al vecino el aviso
    // de "sesión caducada" cuando en realidad el trámite ya fue completado.
    // Al llamarla de nuevo con el estado ya en INICIAL, la función cancela el
    // timeout activo (clearTimeout) y no crea uno nuevo.
    gestionarTimeout(chatId);

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

    // Retrocedemos al estado anterior en el flujo de conversación.
    // El trámite y el nombre ya están guardados; solo se resetea la fecha.
    estadosUsuarios[chatId] = 'ESPERANDO_FECHA';

    // Reconstruimos el teclado de fechas hábiles, igual que en CALLBACK A.
    const diasHabilesV = proximosDiasHabiles(3);
    const botonesFechasV = diasHabilesV.map((dia) => ([{
      text: formatearFechaTexto(dia),
      callback_data: `fecha_${formatearFechaClave(dia)}`,
    }]));

    bot.sendMessage(
      chatId,
      '📅 Elegí una fecha para tu turno:',
      { reply_markup: { inline_keyboard: botonesFechasV } }
    );
    return;
  }

  // ==============================================================
  // CALLBACK E: El usuario eligió "Nuevo Trámite" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'nuevo_tramite') {

    // Leemos el registro actualizado del usuario desde el disco para conocer
    // exactamente qué trámites ya tiene reservados en este momento.
    const usuariosActualesE = leerUsuarios();

    // Recuperamos el DNI del usuario desde la memoria temporal.
    // Fue guardado cuando el menú de gestión se mostró en la Rama B.
    const dniEnProceso = registrosEnProceso[chatId].dni;

    // Buscamos el objeto del usuario en el array para leer sus turnos.
    const usuarioEnDB = usuariosActualesE.find((u) => u.dni === dniEnProceso);

    // Construimos un Set con los nombres de los trámites que el usuario ya tiene activos.
    // Usamos Set porque has() es más eficiente que includes() para búsquedas repetidas.
    const tramitesActivos = new Set();

    if (usuarioEnDB) {
      // Leemos directamente el array turnos[] del usuario para saber qué trámites
      // ya tiene reservados. El || [] protege ante el caso (improbable) de que
      // el campo no exista en algún registro recién creado.
      (usuarioEnDB.turnos || []).forEach((t) => tramitesActivos.add(t.tramite));
    }

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

    // Leemos el DNI guardado en memoria temporal cuando se mostró el menú.
    const dniModificacion = registrosEnProceso[chatId].dni;

    // Leemos la base de datos fresca para que la lista refleje el estado real.
    const usuariosModificacion = leerUsuarios();
    const usuarioModificacion  = usuariosModificacion.find((u) => u.dni === dniModificacion);

    // Si el usuario no tiene turnos activos, no hay nada que modificar.
    // Revertimos el estado a MENU_GESTION para que pueda elegir otra acción.
    const turnosModificacion = usuarioModificacion ? (usuarioModificacion.turnos || []) : [];
    if (turnosModificacion.length === 0) {
      estadosUsuarios[chatId] = 'MENU_GESTION';
      bot.sendMessage(chatId, '⚠️ No tenés turnos activos para modificar.');
      return;
    }

    // Construimos el Inline Keyboard dinámico: una fila por cada turno activo.
    // map() genera un botón con la descripción del turno y el índice en callback_data.
    // El índice "i" se incluye en "editar_i" para identificar cuál turno reeditar.
    const botonesEditar = turnosModificacion.map((t, i) => ([{
      text: `✏️ ${t.tramite} — ${t.fecha} ${t.horario} hs`,
      callback_data: `editar_${i}`,
    }]));

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

    // Extraemos el índice numérico del callback_data (ej: "editar_1" → 1).
    const indiceEditar = parseInt(data.replace('editar_', ''), 10);

    // Validamos que el índice sea un entero válido antes de operar.
    if (isNaN(indiceEditar)) {
      bot.sendMessage(chatId, '⚠️ Ocurrió un error al procesar la selección. Intentá de nuevo.');
      return;
    }

    // Leemos el DNI y buscamos al usuario en la base de datos fresca.
    const dniEditar      = registrosEnProceso[chatId].dni;
    const usuariosEditar = leerUsuarios();

    // findIndex() nos da la posición en el array principal para poder mutar
    // el objeto directamente; necesitamos el índice y no solo el objeto.
    const indiceUsuarioEditar = usuariosEditar.findIndex((u) => u.dni === dniEditar);

    // Verificación defensiva: el usuario debe existir en la base de datos.
    if (indiceUsuarioEditar === -1) {
      bot.sendMessage(chatId, '⚠️ No se encontró tu registro. Escribí tu DNI para volver a ingresar.');
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    const usuarioAEditar = usuariosEditar[indiceUsuarioEditar];

    // Verificación defensiva: el índice del turno debe existir en el array.
    // Protege contra clics en botones de mensajes viejos o desactualizados.
    if (indiceEditar < 0 || indiceEditar >= usuarioAEditar.turnos.length) {
      bot.sendMessage(chatId, '⚠️ Ese turno ya no existe. Escribí tu DNI para volver a ingresar.');
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    // PASO CLAVE: guardamos el nombre del trámite del turno que se va a reemplazar.
    // Lo necesitamos en registrosEnProceso para que el flujo de fecha/horario
    // sepa qué trámite está en proceso, igual que cuando se saca un turno nuevo.
    const tramiteAEditar = usuarioAEditar.turnos[indiceEditar].tramite;
    registrosEnProceso[chatId].tramite = tramiteAEditar;

    // Bandera que le indica al CALLBACK C (confirmación de horario) que este flujo
    // es una modificación y no un turno nuevo. Con ella diferenciamos el mensaje final
    // sin necesidad de crear un callback de confirmación separado.
    registrosEnProceso[chatId].esModificacion = true;

    // LIBERACIÓN DEL CUPO: eliminamos el turno viejo ANTES de pedir la nueva fecha.
    // Esto es fundamental: si no lo borramos primero, el cupo que este usuario
    // ocupa aparecería como "tomado" en la lógica anti-superposición al elegir
    // la nueva fecha, impidiéndole reservar el mismo horario si lo desea.
    // splice(indiceEditar, 1) elimina exactamente ese elemento y cierra el hueco.
    usuarioAEditar.turnos.splice(indiceEditar, 1);

    // REGLA DE LIMPIEZA: si el array turnos quedó vacío tras el splice,
    // eliminamos al usuario del array principal para mantener el JSON limpio.
    // No es un problema borrarlo: al final del flujo se volverá a crear con el
    // nuevo turno, igual que si fuera un usuario que se registra por primera vez.
    if (usuarioAEditar.turnos.length === 0) {
      // splice sobre el array raíz elimina el objeto del usuario por completo.
      usuariosEditar.splice(indiceUsuarioEditar, 1);
    }

    // Persistimos la base de datos con el turno viejo ya eliminado.
    // El cupo queda liberado desde este momento.
    guardarUsuarios(usuariosEditar);

    console.log(`✏️  Turno a modificar liberado: DNI ${dniEditar} → índice ${indiceEditar} (${tramiteAEditar})`);

    // Avanzamos el estado: el flujo de fecha y horario es exactamente el mismo
    // que cuando se saca un turno nuevo; no hace falta duplicar esa lógica.
    estadosUsuarios[chatId] = 'ESPERANDO_FECHA';

    // Construimos el Inline Keyboard con los próximos 3 días hábiles,
    // idéntico al que se genera en CALLBACK A cuando el usuario elige un trámite.
    const diasHabilesE = proximosDiasHabiles(3);
    const botonesFechasE = diasHabilesE.map((dia) => ([{
      text: formatearFechaTexto(dia),
      callback_data: `fecha_${formatearFechaClave(dia)}`,
    }]));

    bot.sendMessage(
      chatId,
      `Turno anterior liberado. 📅 Elegí la nueva fecha para tu trámite de *${tramiteAEditar}*:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: botonesFechasE },
      }
    );
    return;
  }

  // ==============================================================
  // CALLBACK F3: El usuario se arrepintió desde la pantalla de modificación
  // ==============================================================
  if (data === 'volver_menu_gestion') {

    // Limpiamos la memoria temporal y devolvemos al estado INICIAL.
    // Al ingresar el DNI de nuevo el bot muestra el menú actualizado.
    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'INICIAL';

    bot.sendMessage(
      chatId,
      'Operación cancelada. Ingresá tu DNI para volver al menú principal.'
    );
    return;
  }

  // ==============================================================
  // CALLBACK G: El usuario eligió "Cancelar Turno" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'cancelar_turno') {

    // Cambiamos el estado para que los próximos callbacks de este usuario
    // sean interpretados como una selección dentro del flujo de cancelación.
    estadosUsuarios[chatId] = 'ESPERANDO_CANCELACION';

    // Leemos el DNI que guardamos en memoria temporal al mostrar el menú.
    const dniCancelacion = registrosEnProceso[chatId].dni;

    // Buscamos el registro actualizado del usuario en el disco.
    // Usamos leerUsuarios() en lugar de la copia en memoria para garantizar
    // que los turnos mostrados reflejen el estado real de la base de datos.
    const usuariosCancelacion = leerUsuarios();
    const usuarioCancelacion  = usuariosCancelacion.find((u) => u.dni === dniCancelacion);

    // Si el usuario no tiene turnos (o no se encontró), avisamos y no avanzamos.
    // Volvemos el estado a MENU_GESTION para que pueda intentar otra acción.
    const turnosCancelacion = usuarioCancelacion ? (usuarioCancelacion.turnos || []) : [];
    if (turnosCancelacion.length === 0) {
      estadosUsuarios[chatId] = 'MENU_GESTION';
      bot.sendMessage(chatId, '⚠️ No tenés turnos activos para cancelar.');
      return;
    }

    // Construimos el Inline Keyboard dinámico: un botón por cada turno activo.
    // map() recorre el array y por cada elemento (t) genera una fila con un botón.
    // El texto del botón resume el turno en formato corto; el callback_data
    // incluye el índice "i" para identificar cuál turno borrar al recibirlo.
    const botonesTurnos = turnosCancelacion.map((t, i) => {
      // Formateamos la fecha al estilo DD/MM para que el botón sea compacto.
      // split('-') separa "2026-03-18" en ["2026", "03", "18"]; tomamos día y mes.
      const partesFecha = t.fecha.split(' ');
      // La fecha en el JSON es texto legible (ej: "martes 18 de marzo"),
      // así que la mostramos tal cual pero recortamos solo día y mes para brevedad.
      return [{
        text: `❌ ${t.tramite} — ${t.fecha} ${t.horario} hs`,
        callback_data: `borrar_${i}`,
      }];
    });

    // Agregamos al final una fila con el botón de retroceso para que el usuario
    // pueda salir del flujo de cancelación sin eliminar ningún turno.
    botonesTurnos.push([{ text: '⬅️ Volver al menú', callback_data: 'volver_menu' }]);

    bot.sendMessage(
      chatId,
      'Seleccioná el turno que deseás cancelar:',
      { reply_markup: { inline_keyboard: botonesTurnos } }
    );
    return;
  }

  // ==============================================================
  // CALLBACK H: El usuario confirmó qué turno borrar (botón "borrar_N")
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CANCELACION' && data.startsWith('borrar_')) {

    // Extraemos el índice numérico del callback_data (ej: "borrar_2" → 2).
    // parseInt con base 10 convierte el string al entero que usaremos con splice().
    const indiceTurno = parseInt(data.replace('borrar_', ''), 10);

    // Validamos que el índice sea un número entero válido.
    // isNaN() devuelve true si parseInt no pudo convertir el valor correctamente.
    if (isNaN(indiceTurno)) {
      bot.sendMessage(chatId, '⚠️ Ocurrió un error al procesar la selección. Intentá de nuevo.');
      return;
    }

    // Recuperamos el DNI y leemos la base de datos fresca del disco.
    const dniBorrar   = registrosEnProceso[chatId].dni;
    const usuariosBorrar = leerUsuarios();

    // findIndex() devuelve la posición del usuario en el array principal,
    // o -1 si no se encontró. Necesitamos el índice (no el objeto) para poder
    // modificar el registro directamente dentro del array y luego guardarlo.
    const indiceUsuarioBorrar = usuariosBorrar.findIndex((u) => u.dni === dniBorrar);

    // Verificación defensiva: si el usuario no existe en la DB, abortamos.
    if (indiceUsuarioBorrar === -1) {
      bot.sendMessage(chatId, '⚠️ No se encontró tu registro. Escribí tu DNI para volver a ingresar.');
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    const usuarioAModificar = usuariosBorrar[indiceUsuarioBorrar];

    // Verificación defensiva: el índice del turno debe existir dentro del array.
    // Esto evita crashear si el usuario hizo clic en un botón desactualizado.
    if (indiceTurno < 0 || indiceTurno >= usuarioAModificar.turnos.length) {
      bot.sendMessage(chatId, '⚠️ Ese turno ya no existe. Escribí tu DNI para volver a ingresar.');
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    // Capturamos los datos del turno ANTES de eliminarlo con splice.
    // Una vez que splice lo borra del array, esos datos ya no son accesibles,
    // así que los guardamos en una variable para armar el mensaje de confirmación.
    const turnoCancelado = usuarioAModificar.turnos[indiceTurno];

    // splice(inicio, cantidad) modifica el array EN SU LUGAR (muta el original).
    // Con inicio = indiceTurno y cantidad = 1, elimina exactamente ese un elemento.
    // Los elementos siguientes se desplazan automáticamente para cerrar el hueco.
    usuarioAModificar.turnos.splice(indiceTurno, 1);

    // REGLA DE ORO: si después del splice el array turnos quedó vacío,
    // no tiene sentido mantener el registro del usuario en la base de datos.
    // Usamos otro splice sobre el array PRINCIPAL para eliminar al usuario completo.
    // Esto mantiene el JSON limpio y evita acumular entradas sin información útil.
    if (usuarioAModificar.turnos.length === 0) {
      // splice(indiceUsuarioBorrar, 1) elimina el objeto del usuario del array raíz.
      usuariosBorrar.splice(indiceUsuarioBorrar, 1);
    }

    // Persistimos los cambios en el archivo JSON del disco.
    guardarUsuarios(usuariosBorrar);

    console.log(`🗑️  Turno cancelado: DNI ${dniBorrar} → ${turnoCancelado.tramite} | ${turnoCancelado.fecha} ${turnoCancelado.horario}`);

    // Armamos la primera parte del mensaje con los datos del turno cancelado.
    // Usamos los datos que guardamos en turnoCancelado antes del splice.
    let mensajeCancelacion =
      `❌ Cancelaste exitosamente el turno de *${turnoCancelado.tramite}* ` +
      `del *${turnoCancelado.fecha}* a las *${turnoCancelado.horario}* hs.`;

    // Si al usuario le quedan turnos activos, los listamos debajo del mensaje principal.
    // Verificamos la longitud DESPUÉS del splice; si es 0, no agregamos nada.
    // map() convierte cada turno restante en un renglón numerado para facilitar la lectura.
    if (usuarioAModificar.turnos.length > 0) {
      const renglonesRestantes = usuarioAModificar.turnos.map((t, i) =>
        `  *${i + 1}.* ${t.tramite} — ${t.fecha} a las ${t.horario} hs`
      );
      // join() une todos los renglones con salto de línea para armar el bloque de texto.
      mensajeCancelacion +=
        '\n\nTus turnos activos son:\n' + renglonesRestantes.join('\n');
    }

    // Agregamos la instrucción para volver al menú como párrafo final.
    mensajeCancelacion += '\n\nPor favor, ingresá tu número de DNI para volver al menú principal.';

    // Limpiamos la memoria temporal y cambiamos el estado a ESPERANDO_DNI.
    // Usamos ESPERANDO_DNI (no INICIAL) para que el bot esté listo para recibir
    // el DNI inmediatamente sin que el usuario tenga que escribir "hola" primero.
    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'ESPERANDO_DNI';

    bot.sendMessage(chatId, mensajeCancelacion, { parse_mode: 'Markdown' });
    return;
  }

  // ==============================================================
  // CALLBACK I: El usuario tocó "Volver al menú" desde la pantalla de cancelación
  // ==============================================================
  if (data === 'volver_menu') {

    // Limpiamos la memoria temporal y devolvemos al usuario al estado INICIAL.
    // Al pedir el DNI de nuevo el bot muestra el menú con los datos actualizados,
    // lo que garantiza que la vista sea siempre consistente con la base de datos.
    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'INICIAL';

    bot.sendMessage(
      chatId,
      'Operación cancelada. Ingresá tu DNI para volver al menú principal.'
    );
    return;
  }
});

// ---------------------------------------------------------------
// 13. MANEJO DE ERRORES DE POLLING
// ---------------------------------------------------------------
bot.on('polling_error', (error) => {
  console.error('❌ Error de conexión con Telegram:', error.message);
});
