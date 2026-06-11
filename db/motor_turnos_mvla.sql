-- =============================================================================
-- MOTOR DE TURNOS MVLA — Esquema de base de datos
-- Municipalidad de Villa La Angostura
-- Versión 1.0
-- =============================================================================
-- Cómo usar este script:
--   1. Crear la base de datos primero (o usar una existente)
--   2. Ejecutar este script completo
--   3. El orden de creación de tablas respeta las dependencias entre ellas
--
-- Para ejecutarlo desde la terminal:
--   mysql -u root -p motor_turnos < motor_turnos_mvla.sql
-- =============================================================================

-- Si necesitás borrar todo y empezar de cero durante el desarrollo,
-- descomentá las siguientes líneas (¡CUIDADO: borra todos los datos!):
-- DROP TABLE IF EXISTS auditoria;
-- DROP TABLE IF EXISTS turnos;
-- DROP TABLE IF EXISTS bloqueos;
-- DROP TABLE IF EXISTS horarios;
-- DROP TABLE IF EXISTS usuario_areas;
-- DROP TABLE IF EXISTS servicios;
-- DROP TABLE IF EXISTS vecinos;
-- DROP TABLE IF EXISTS usuarios;
-- DROP TABLE IF EXISTS feriados;
-- DROP TABLE IF EXISTS areas;

-- Crear la base de datos si no existe
CREATE DATABASE IF NOT EXISTS motor_turnos
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE motor_turnos;

-- =============================================================================
-- GRUPO 1: LA ORGANIZACIÓN
-- Tablas que definen la estructura del municipio
-- =============================================================================

-- -----------------------------------------------------------------------------
-- areas: Las dependencias municipales (Licencias, Tribunal de Faltas, etc.)
-- Cada área tiene sus propios servicios y operadores
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS areas (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(100)  NOT NULL               COMMENT 'Ej: Licencias de Conducir',
  descripcion VARCHAR(255)  NULL,
  activo      BOOLEAN       NOT NULL DEFAULT TRUE   COMMENT 'FALSE = área dada de baja, se conserva el historial',
  created_at  DATETIME      NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Dependencias municipales que brindan servicios con turno';


-- -----------------------------------------------------------------------------
-- servicios: Los trámites disponibles dentro de cada área
-- Un servicio pertenece a un área, tiene duración y mensaje de confirmación
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servicios (
  id                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  area_id              INT UNSIGNED  NOT NULL               COMMENT 'A qué área pertenece este servicio',
  nombre               VARCHAR(100)  NOT NULL               COMMENT 'Ej: Nueva Licencia, Renovación',
  duracion_min         TINYINT UNSIGNED NOT NULL            COMMENT 'Duración de cada turno en minutos (15, 30, 45...)',
  mensaje_confirmacion TEXT          NULL                   COMMENT 'Texto que se envía al vecino al confirmar el turno. Reemplaza Google Sheets',
  max_dias_anticipacion TINYINT UNSIGNED NOT NULL DEFAULT 30 COMMENT 'Horizonte de reserva en días hábiles',
  activo               BOOLEAN       NOT NULL DEFAULT TRUE   COMMENT 'FALSE = servicio suspendido, conserva historial',
  created_at           DATETIME      NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id),
  CONSTRAINT fk_servicios_area
    FOREIGN KEY (area_id) REFERENCES areas (id),

  -- Índice para buscar todos los servicios de un área rápidamente
  INDEX idx_servicios_area (area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Trámites disponibles en cada área municipal';


-- -----------------------------------------------------------------------------
-- feriados: Días no laborables nacionales y locales
-- motor.js consulta esta tabla al calcular la disponibilidad
-- Los nacionales los sincroniza api.argentinadatos.com
-- Los locales se cargan manualmente con el script de administración
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feriados (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  fecha       DATE          NOT NULL               COMMENT 'Fecha del feriado',
  descripcion VARCHAR(255)  NOT NULL               COMMENT 'Ej: Día de la Independencia, Aniversario VLA',
  tipo        ENUM('nacional', 'local') NOT NULL   COMMENT 'Nacional: viene de api.argentinadatos.com | Local: cargado a mano',
  created_at  DATETIME      NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id),
  -- Una misma fecha no puede cargarse dos veces
  UNIQUE KEY uq_feriados_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Días feriados nacionales y locales excluidos de la disponibilidad';


-- =============================================================================
-- GRUPO 2: LAS PERSONAS
-- Vecinos que reservan turnos y usuarios que gestionan el sistema
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vecinos: Los contribuyentes que reservan turnos
-- El DNI es la clave de identificación en todos los canales
-- Un mismo vecino puede reservar por WhatsApp, web o presencialmente
-- y siempre se lo reconoce por el DNI
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vecinos (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  dni             VARCHAR(15)   NOT NULL               COMMENT 'Clave de identificación única en todos los canales',
  nombre          VARCHAR(150)  NOT NULL,
  telefono        VARCHAR(20)   NULL                   COMMENT 'NULL si se registró por web y no ingresó teléfono',
  canal_registro  ENUM('whatsapp', 'web', 'presencial') NOT NULL COMMENT 'Por qué canal entró al sistema por primera vez',
  created_at      DATETIME      NOT NULL DEFAULT NOW(),
  updated_at      DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW() COMMENT 'Se actualiza si el vecino corrige sus datos',

  PRIMARY KEY (id),
  -- El DNI no puede repetirse
  UNIQUE KEY uq_vecinos_dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Contribuyentes que reservan turnos por cualquier canal';


-- -----------------------------------------------------------------------------
-- usuarios: Los empleados municipales que usan el panel
-- No confundir con vecinos — son los operadores y encargados
-- Un usuario puede pertenecer a múltiples áreas (ver tabla usuario_areas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nombre        VARCHAR(150)  NOT NULL,
  email         VARCHAR(255)  NOT NULL               COMMENT 'Se usa como nombre de usuario para el login',
  password_hash VARCHAR(255)  NOT NULL               COMMENT 'Contraseña encriptada con bcrypt. Nunca se guarda en texto plano',
  activo              BOOLEAN       NOT NULL DEFAULT TRUE   COMMENT 'FALSE = acceso suspendido. No se borra el usuario para conservar auditoría',
  ultimo_acceso       DATETIME      NULL                   COMMENT 'Última vez que inició sesión. Útil para detectar cuentas inactivas',
  debe_cambiar_clave  BOOLEAN       NOT NULL DEFAULT FALSE  COMMENT 'TRUE = el usuario debe cambiar su contraseña al próximo login (p.ej. clave temporal asignada por sistemas)',
  created_at          DATETIME      NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id),
  -- El email no puede repetirse
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Empleados municipales con acceso al panel de gestión';


-- -----------------------------------------------------------------------------
-- usuario_areas: Tabla intermedia que conecta usuarios con áreas
-- Resuelve que un usuario pueda ser encargado de múltiples áreas
-- Ej: un secretario puede ser encargado en Licencias Y en Tribunal de Faltas
-- El mismo usuario puede tener roles distintos en áreas distintas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_areas (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED  NOT NULL,
  area_id     INT UNSIGNED  NOT NULL,
  rol           ENUM('operador', 'encargado', 'sistemas', 'directivo') NOT NULL COMMENT 'Define qué puede hacer en esta área específica',
  atiende_turnos BOOLEAN     NOT NULL DEFAULT FALSE COMMENT 'TRUE = este usuario ocupa slots de disponibilidad (operadores). FALSE = encargados/directivos que no atienden turnos.',
  created_at  DATETIME      NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id),
  -- Un usuario no puede tener dos entradas para la misma área
  UNIQUE KEY uq_usuario_areas (usuario_id, area_id),

  CONSTRAINT fk_usuario_areas_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_usuario_areas_area
    FOREIGN KEY (area_id) REFERENCES areas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Asignación de usuarios a áreas con su rol en cada una';


-- =============================================================================
-- GRUPO 3: LA DISPONIBILIDAD
-- Cuándo atienden los operadores y cuándo NO atienden
-- =============================================================================

-- -----------------------------------------------------------------------------
-- horarios: Bloques de atención regulares de cada operador
-- Define cuándo atiende un operador para un servicio en un día de la semana
-- motor.js usa esto como base para calcular los slots disponibles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS horarios (
  id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED      NOT NULL               COMMENT 'El operador',
  servicio_id INT UNSIGNED      NOT NULL               COMMENT 'Para qué trámite aplica este horario',
  dia_semana  TINYINT UNSIGNED  NOT NULL               COMMENT '1=lunes, 2=martes, 3=miércoles, 4=jueves, 5=viernes, 6=sábado, 7=domingo',
  hora_inicio TIME              NOT NULL               COMMENT 'Ej: 08:00',
  hora_fin    TIME              NOT NULL               COMMENT 'Ej: 13:00',
  activo      BOOLEAN           NOT NULL DEFAULT TRUE,

  PRIMARY KEY (id),
  -- Un operador no puede tener dos horarios para el mismo servicio el mismo día
  UNIQUE KEY uq_horarios (usuario_id, servicio_id, dia_semana),

  CONSTRAINT fk_horarios_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_horarios_servicio
    FOREIGN KEY (servicio_id) REFERENCES servicios (id),

  INDEX idx_horarios_servicio (servicio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Horarios regulares de atención por operador y servicio';


-- -----------------------------------------------------------------------------
-- bloqueos: Excepciones al horario regular
-- Cubre días de licencia, feriados del área, cortes de luz, etc.
-- Tipo 'individual': bloquea un operador específico (usuario_id requerido)
-- Tipo 'oficina': bloquea toda el área (usuario_id NULL, afecta todos los operadores)
-- Si hora_inicio y hora_fin son NULL, el bloqueo es de día completo
-- Si servicio_id es NULL, el bloqueo afecta todos los servicios del área
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloqueos (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  tipo        ENUM('individual', 'oficina') NOT NULL  COMMENT 'individual = un operador | oficina = toda el área',
  usuario_id  INT UNSIGNED  NULL                      COMMENT 'Qué operador está bloqueado. NULL cuando tipo=oficina',
  area_id     INT UNSIGNED  NOT NULL                  COMMENT 'Siempre se sabe qué área está afectada',
  servicio_id INT UNSIGNED  NULL                      COMMENT 'NULL = afecta todos los servicios del área',
  fecha_inicio DATE         NOT NULL,
  fecha_fin    DATE         NOT NULL,
  hora_inicio  TIME         NULL                      COMMENT 'NULL = bloqueo de día completo',
  hora_fin     TIME         NULL                      COMMENT 'NULL = bloqueo de día completo',
  motivo       VARCHAR(255) NOT NULL                  COMMENT 'Ej: Licencia médica, Corte de luz, Capacitación',
  creado_por   INT UNSIGNED NOT NULL                  COMMENT 'Quién cargó el bloqueo (distinto de usuario_id, que es quién está bloqueado)',
  created_at   DATETIME     NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id),

  CONSTRAINT fk_bloqueos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_bloqueos_area
    FOREIGN KEY (area_id) REFERENCES areas (id),
  CONSTRAINT fk_bloqueos_servicio
    FOREIGN KEY (servicio_id) REFERENCES servicios (id),
  CONSTRAINT fk_bloqueos_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuarios (id),

  -- Índice para que motor.js consulte bloqueos por rango de fechas rápidamente
  INDEX idx_bloqueos_fechas (fecha_inicio, fecha_fin),
  INDEX idx_bloqueos_usuario (usuario_id),
  INDEX idx_bloqueos_area (area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Excepciones al horario regular: licencias, feriados de área, cortes, etc.';


-- =============================================================================
-- GRUPO 4: LA OPERACIÓN
-- Los turnos en sí y el registro de auditoría
-- =============================================================================

-- -----------------------------------------------------------------------------
-- turnos: El corazón del sistema
-- Cada fila es un turno reservado por un vecino para un servicio
-- El operador se asigna automáticamente por round robin
-- hora_fin se calcula en motor.js: hora_inicio + duracion_min del servicio
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turnos (
  id                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  vecino_id            INT UNSIGNED  NOT NULL               COMMENT 'Quién reservó el turno',
  servicio_id          INT UNSIGNED  NOT NULL               COMMENT 'Para qué trámite',
  operador_id          INT UNSIGNED  NULL                   COMMENT 'NULL hasta que el operador lo toma al llegar el vecino. Se asigna con tomarTurno().',
  fecha                DATE          NOT NULL,
  hora_inicio          TIME          NOT NULL,
  hora_fin             TIME          NOT NULL               COMMENT 'Calculado por motor.js: hora_inicio + duracion_min del servicio',
  estado               ENUM('agendado', 'presente', 'ausente', 'atendido', 'cancelado', 'reprogramado')
                                     NOT NULL DEFAULT 'agendado',
  canal_origen         ENUM('whatsapp', 'web', 'presencial') NOT NULL COMMENT 'Por qué canal se reservó',
  motivo_cancelacion   VARCHAR(255)  NULL                   COMMENT 'Solo se completa cuando estado=cancelado',
  recordatorio_enviado BOOLEAN       NOT NULL DEFAULT FALSE  COMMENT 'Marca si el cron ya envió el recordatorio para no duplicarlo',
  created_at           DATETIME      NOT NULL DEFAULT NOW(),
  updated_at           DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),

  PRIMARY KEY (id),

  CONSTRAINT fk_turnos_vecino
    FOREIGN KEY (vecino_id) REFERENCES vecinos (id),
  CONSTRAINT fk_turnos_servicio
    FOREIGN KEY (servicio_id) REFERENCES servicios (id),
  CONSTRAINT fk_turnos_operador
    FOREIGN KEY (operador_id) REFERENCES usuarios (id),

  -- Índices para las consultas más frecuentes
  INDEX idx_turnos_fecha          (fecha),
  INDEX idx_turnos_estado         (estado),
  INDEX idx_turnos_vecino         (vecino_id),
  INDEX idx_turnos_operador       (operador_id),
  INDEX idx_turnos_servicio       (servicio_id),
  -- Índice compuesto para el cron de recordatorios
  INDEX idx_turnos_recordatorio   (fecha, estado, recordatorio_enviado),
  -- Índice compuesto para verificar turno activo de un vecino en un servicio
  INDEX idx_turnos_vecino_servicio (vecino_id, servicio_id, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Turnos reservados. El corazón del sistema';


-- -----------------------------------------------------------------------------
-- auditoria: Registro completo de todas las acciones en el sistema
-- No solo registra acciones sobre turnos — registra CUALQUIER cambio
-- en cualquier entidad (servicios, bloqueos, usuarios, áreas, feriados)
-- Esta tabla nunca se borra ni se modifica — solo se agregan filas
-- usuario_id puede ser NULL si la acción la hizo el sistema automáticamente
-- (ej: el cron que envía recordatorios)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  usuario_id    INT UNSIGNED  NULL                   COMMENT 'NULL si la acción la ejecutó el sistema automáticamente',
  entidad_tipo  ENUM('turno', 'servicio', 'bloqueo', 'usuario', 'area', 'feriado', 'horario') NOT NULL
                                                     COMMENT 'Qué tipo de entidad fue afectada',
  entidad_id    INT UNSIGNED  NOT NULL               COMMENT 'ID del registro afectado en su tabla correspondiente',
  accion        ENUM('crear', 'modificar', 'cancelar', 'eliminar', 'bloquear', 'desbloquear', 'login', 'logout') NOT NULL,
  detalle       JSON          NULL                   COMMENT 'Contexto adicional: valores anteriores, motivo, etc.',
  canal         ENUM('bot', 'panel', 'sistema', 'web') NOT NULL COMMENT 'Desde dónde se realizó la acción',
  ip            VARCHAR(45)   NULL                   COMMENT 'IP desde la que se realizó la acción. NULL si fue el sistema',
  timestamp     DATETIME      NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id),

  CONSTRAINT fk_auditoria_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id),

  -- Índices para consultar el historial rápidamente
  INDEX idx_auditoria_entidad    (entidad_tipo, entidad_id),
  INDEX idx_auditoria_usuario    (usuario_id),
  INDEX idx_auditoria_timestamp  (timestamp),
  INDEX idx_auditoria_accion     (accion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Registro inmutable de todas las acciones del sistema. Nunca se borra';


-- =============================================================================
-- DATOS INICIALES (seed data)
-- Información mínima para que el sistema arranque
-- =============================================================================

-- Áreas del PoC
INSERT INTO areas (nombre, descripcion) VALUES
  ('Licencias de Conducir', 'Gestión de licencias nuevas y renovaciones'),
  ('Tribunal de Faltas',    'Pago y gestión de multas de tránsito');

-- Servicios del PoC (IDs corresponden a los servicios actuales de EA para facilitar la migración)
INSERT INTO servicios (area_id, nombre, duracion_min, max_dias_anticipacion, mensaje_confirmacion) VALUES
  (1, 'Nueva Licencia',   30, 30, 'Tu turno fue confirmado. Recordá traer: DNI original, certificado de aptitud médica y comprobante de pago de tasa.'),
  (2, 'Pago de Multas',   15, 30, 'Tu turno fue confirmado. Recordá traer: DNI original y número de acta de infracción.');

-- =============================================================================
-- FIN DEL SCRIPT
-- =============================================================================
-- Tablas creadas: 10
-- Relaciones (FK): 14
-- Índices: 15
-- Datos iniciales: 2 áreas, 2 servicios
-- =============================================================================
