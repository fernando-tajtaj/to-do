/* ============================================================================
 * ARCHIVO: database.js
 * DESCRIPCIÓN: Configuración y creación de la base de datos del sistema.
 *
 * PROPÓSITO:
 *   Este archivo se encarga de conectar con la base de datos SQLite y crear
 *   todas las tablas necesarias para que el sistema funcione correctamente.
 *   SQLite es una base de datos ligera que guarda todo en un archivo local,
 *   lo cual es perfecto para proyectos académicos y prototipos.
 *
 * TECNOLOGÍA UTILIZADA:
 *   - SQLite3: Motor de base de datos relacional embebido (no necesita servidor)
 *   - Node.js path: Para manejar rutas de archivos de forma segura
 *
 * DIAGRAMA DE RELACIONES (Modelo Entidad-Relación):
 *   usuarios (1) ---< (N) proyectos
 *   proyectos (1) ---< (N) tableros
 *   tableros (1) ---< (N) columnas
 *   columnas (1) ---< (N) tareas
 *   tareas (1) ---< (N) subtareas
 *   tareas (1) ---< (N) comentarios
 *   tareas (1) ---< (N) bitacora
 *
 * AUTOR: Equipo de Calidad de Software
 * FECHA: 2024
 * ============================================================================ */

// ── PASO 1: Importar las librerías necesarias ───────────────────────────────
// "sqlite3" es la librería que nos permite trabajar con bases de datos SQLite
// "path" es una utilidad de Node.js para construir rutas de archivos
const sqlite3 = require("sqlite3").verbose(); // .verbose() nos da mensajes de error más detallados
const path = require("path"); // Para resolver rutas absolutas del sistema
const fs = require("fs");

// ── PASO 2: Crear la conexión a la base de datos ─────────────────────────────
// Definimos dónde se va a guardar el archivo de la base de datos
// __dirname = carpeta donde está este archivo (database.js)
// 'sistema.db' = nombre del archivo de base de datos que se creará
const rutaBaseDeDatos = path.resolve(__dirname, "..", "data", "sistema.db");

// SQLite crea el archivo pero no la carpeta (data/ no se sube a git)
fs.mkdirSync(path.dirname(rutaBaseDeDatos), { recursive: true });

// Creamos la conexión: si el archivo no existe, SQLite lo crea automáticamente
const db = new sqlite3.Database(rutaBaseDeDatos, (error) => {
  if (error) {
    // Si hay un error (por ejemplo: permisos de archivo), lo mostramos
    console.error("❌ Error al conectar con la base de datos:", error.message);
  } else {
    // Si todo salió bien, confirmamos la conexión
    console.log("✅ Base de datos SQLite conectada correctamente.");
  }
});

// ── PASO 3: Activar las claves foráneas (integridad referencial) ─────────────
// Por defecto, SQLite NO valida las relaciones entre tablas.
// Esta línea activa esa validación para asegurar la consistencia de los datos.
db.run("PRAGMA foreign_keys = ON");

// ── PASO 4: Crear todas las tablas del sistema ──────────────────────────────
// db.serialize() ejecuta las consultas UNA POR UNA en orden.
// Esto es importante porque algunas tablas dependen de otras.
db.serialize(() => {
  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 1: USUARIOS                                                  ║
   * ║  Almacena la información de cada persona registrada en el sistema.   ║
   * ║  Es la tabla principal porque casi todo depende de quién lo hizo.    ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,  -- Identificador único, se genera solo
        nombre   TEXT    NOT NULL,                    -- Nombre completo del usuario
        correo   TEXT    UNIQUE NOT NULL,             -- Email único (no se puede repetir)
        password TEXT    NOT NULL,                    -- Contraseña encriptada con bcrypt
        rol      TEXT    NOT NULL                     -- 'Administrador' o 'Miembro/Colaborador'
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 2: PROYECTOS                                                 ║
   * ║  Un proyecto es el contenedor principal de trabajo.                  ║
   * ║  Cada proyecto pertenece al usuario que lo creó.                     ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS proyectos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre       TEXT    NOT NULL,
    descripcion  TEXT,
    creado_por   INTEGER,
    clave_acceso TEXT,
    FOREIGN KEY (creado_por) REFERENCES usuarios(id)
)`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 3: TABLEROS                                                  ║
   * ║  Un tablero es como un "Sprint" o fase dentro de un proyecto.        ║
   * ║  Cada proyecto puede tener múltiples tableros (Sprint 1, Sprint 2). ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS tableros (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,     -- Identificador único del tablero
        nombre      TEXT    NOT NULL,                       -- Nombre del tablero (ej: "Sprint 1")
        proyecto_id INTEGER,                                -- A qué proyecto pertenece
        FOREIGN KEY (proyecto_id) REFERENCES proyectos(id)  -- Relación: tablero → proyecto
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 4: COLUMNAS (Estados del flujo de trabajo)                   ║
   * ║  Representan las etapas por las que pasa una tarea:                  ║
   * ║  "Por hacer" → "En progreso" → "En revisión / QA" → "Completado"    ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS columnas (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,     -- Identificador único de la columna
        nombre     TEXT    NOT NULL,                       -- Nombre del estado (ej: "En progreso")
        tablero_id INTEGER,                                -- A qué tablero pertenece
        FOREIGN KEY (tablero_id) REFERENCES tableros(id)   -- Relación: columna → tablero
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 5: TAREAS                                                    ║
   * ║  Son las unidades de trabajo. Cada tarea tiene un título, prioridad,║
   * ║  responsable, fechas y pertenece a una columna específica.           ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS tareas (
        id              INTEGER  PRIMARY KEY AUTOINCREMENT,  -- Identificador único de la tarea
        titulo          TEXT     NOT NULL,                    -- Nombre corto de la tarea
        descripcion     TEXT,                                 -- Descripción detallada (opcional)
        prioridad       TEXT,                                 -- 'Alta', 'Media' o 'Baja'
        estado_id       INTEGER,                              -- En qué columna está actualmente
        responsable_id  INTEGER,                              -- Quién está encargado de la tarea
        fecha_creacion  DATETIME DEFAULT CURRENT_TIMESTAMP,   -- Cuándo se creó (automático)
        fecha_inicio    DATE,                                 -- Cuándo se empezó a trabajar
        fecha_limite    DATE,                                 -- Fecha límite de entrega
        FOREIGN KEY (estado_id)      REFERENCES columnas(id), -- Relación: tarea → columna
        FOREIGN KEY (responsable_id) REFERENCES usuarios(id)  -- Relación: tarea → usuario
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 6: SUBTAREAS (Checklist de una tarea)                         ║
   * ║  Son los pasos pequeños que se deben completar dentro de una tarea.  ║
   * ║  Sirven como lista de verificación (checklist) para asegurar que     ║
   * ║  la tarea se completó correctamente.                                 ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS subtareas (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,   -- Identificador único
        titulo     TEXT    NOT NULL,                     -- Descripción de la subtarea
        completada BOOLEAN DEFAULT 0,                    -- 0 = pendiente, 1 = completada
        tarea_id   INTEGER,                              -- A qué tarea pertenece
        FOREIGN KEY (tarea_id) REFERENCES tareas(id)     -- Relación: subtarea → tarea
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 7: BITÁCORA (Registro de trazabilidad)                       ║
   * ║  Guarda un historial de TODAS las acciones realizadas sobre las     ║
   * ║  tareas. Esto es fundamental para la trazabilidad y auditoría       ║
   * ║  del proceso de calidad de software.                                ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS bitacora (
        id         INTEGER  PRIMARY KEY AUTOINCREMENT,  -- Identificador único del registro
        tarea_id   INTEGER,                              -- Qué tarea fue modificada
        usuario_id INTEGER,                              -- Quién realizó la acción
        accion     TEXT     NOT NULL,                    -- Descripción de lo que se hizo
        fecha      DATETIME DEFAULT CURRENT_TIMESTAMP,   -- Cuándo ocurrió (automático)
        FOREIGN KEY (tarea_id)   REFERENCES tareas(id),  -- Relación: bitácora → tarea
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) -- Relación: bitácora → usuario
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 8: COMENTARIOS                                               ║
   * ║  Permite a los usuarios dejar observaciones o notas en las tareas.  ║
   * ║  Facilita la comunicación del equipo dentro del sistema.             ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS comentarios (
        id         INTEGER  PRIMARY KEY AUTOINCREMENT,  -- Identificador único del comentario
        texto      TEXT     NOT NULL,                    -- Contenido del comentario
        tarea_id   INTEGER,                              -- En qué tarea se comentó
        usuario_id INTEGER,                              -- Quién escribió el comentario
        fecha      DATETIME DEFAULT CURRENT_TIMESTAMP,   -- Cuándo se escribió (automático)
        FOREIGN KEY (tarea_id)   REFERENCES tareas(id),  -- Relación: comentario → tarea
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) -- Relación: comentario → usuario
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 9: RECUPERACIONES (Tokens para restablecer contraseña)       ║
   * ║  Guarda el hash SHA-256 del token enviado por correo (nunca el      ║
   * ║  token en claro), su fecha de expiración y si ya fue utilizado.     ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS recuperaciones (
        id         INTEGER  PRIMARY KEY AUTOINCREMENT,  -- Identificador único
        usuario_id INTEGER  NOT NULL,                    -- Usuario que solicitó la recuperación
        token_hash TEXT     UNIQUE NOT NULL,             -- Hash SHA-256 del token enviado
        expira     DATETIME NOT NULL,                    -- Fecha/hora en que el token caduca
        usado      BOOLEAN  DEFAULT 0,                   -- 0 = disponible, 1 = ya utilizado
        fecha      DATETIME DEFAULT CURRENT_TIMESTAMP,   -- Cuándo se solicitó (automático)
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) -- Relación: recuperación → usuario
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 10: PROYECTO_MIEMBROS (Asignación de usuarios a proyectos)   ║
   * ║  Un Miembro/Colaborador solo ve y trabaja en los tableros de los    ║
   * ║  proyectos a los que un Administrador lo asignó.                    ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS proyecto_miembros (
        proyecto_id INTEGER NOT NULL,                     -- Proyecto asignado
        usuario_id  INTEGER NOT NULL,                     -- Usuario que puede trabajar en él
        PRIMARY KEY (proyecto_id, usuario_id),
        FOREIGN KEY (proyecto_id) REFERENCES proyectos(id),
        FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)
    )`);

  /* ╔══════════════════════════════════════════════════════════════════════╗
   * ║  TABLA 11: CHECKLIST_ITEMS (Checklist propio de cada subtarea)      ║
   * ║  Una subtarea solo puede marcarse como completada cuando todos los  ║
   * ║  elementos de su checklist están marcados.                          ║
   * ╚══════════════════════════════════════════════════════════════════════╝ */
  db.run(`CREATE TABLE IF NOT EXISTS checklist_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        texto       TEXT    NOT NULL,                     -- Descripción del paso a verificar
        completado  BOOLEAN DEFAULT 0,                    -- 0 = pendiente, 1 = hecho
        subtarea_id INTEGER NOT NULL,                     -- Subtarea a la que pertenece
        FOREIGN KEY (subtarea_id) REFERENCES subtareas(id)
    )`);
});

// ── PASO 5: Funciones auxiliares con Promesas ───────────────────────────────
// Permiten usar async/await en lugar de callbacks anidados.
db.ejecutar = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    }),
  );
db.obtener = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, fila) => (err ? reject(err) : resolve(fila))),
  );
db.todos = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, filas) => (err ? reject(err) : resolve(filas))),
  );

// ── PASO 6: Migraciones (actualizan bases de datos existentes sin perder datos)
// PRAGMA user_version guarda qué migraciones ya se aplicaron.
async function agregarColumna(tabla, definicion) {
  const nombre = definicion.split(" ")[0];
  const columnas = await db.todos(`PRAGMA table_info(${tabla})`);
  if (!columnas.some((c) => c.name === nombre))
    await db.ejecutar(`ALTER TABLE ${tabla} ADD COLUMN ${definicion}`);
}

async function migrar() {
  const { user_version: version } = await db.obtener("PRAGMA user_version");

  if (version < 1) {
    // Usuarios: permite desactivar cuentas desde la gestión de usuarios
    await agregarColumna("usuarios", "activo INTEGER DEFAULT 1");

    // Columnas: el "tipo" define las reglas de transición (no el nombre visible)
    await agregarColumna("columnas", "tipo TEXT");
    await agregarColumna("columnas", "orden INTEGER");
    await db.ejecutar(`UPDATE columnas SET tipo = CASE
        WHEN lower(nombre) LIKE '%por hacer%' OR lower(nombre) LIKE '%backlog%' THEN 'por_hacer'
        WHEN lower(nombre) LIKE '%revisi%' OR lower(nombre) LIKE '%qa%' THEN 'en_revision'
        WHEN lower(nombre) LIKE '%complet%' THEN 'completado'
        ELSE 'en_progreso' END
      WHERE tipo IS NULL`);
    await db.ejecutar(`UPDATE columnas SET orden = id WHERE orden IS NULL`);

    // Tareas: tipo (Tarea/Bug), etiquetas, autor y fecha de cierre
    await agregarColumna("tareas", "tipo TEXT DEFAULT 'Tarea'");
    await agregarColumna("tareas", "etiquetas TEXT");
    await agregarColumna("tareas", "creado_por INTEGER");
    await agregarColumna("tareas", "fecha_cierre DATETIME");
    await db.ejecutar(`UPDATE tareas SET tipo = 'Tarea' WHERE tipo IS NULL`);
    await db.ejecutar(`UPDATE tareas SET fecha_cierre = COALESCE(
        (SELECT MAX(b.fecha) FROM bitacora b WHERE b.tarea_id = tareas.id AND b.accion LIKE '%Completado%'),
        CURRENT_TIMESTAMP)
      WHERE fecha_cierre IS NULL
        AND estado_id IN (SELECT id FROM columnas WHERE tipo = 'completado')`);

    // Membresías iniciales: el creador del proyecto y quienes ya participaron en él
    await db.ejecutar(`INSERT OR IGNORE INTO proyecto_miembros (proyecto_id, usuario_id)
      SELECT id, creado_por FROM proyectos WHERE creado_por IS NOT NULL`);
    const participantes = `
      FROM tareas t JOIN columnas c ON t.estado_id = c.id JOIN tableros tb ON c.tablero_id = tb.id`;
    await db.ejecutar(`INSERT OR IGNORE INTO proyecto_miembros (proyecto_id, usuario_id)
      SELECT DISTINCT tb.proyecto_id, t.responsable_id ${participantes} WHERE t.responsable_id IS NOT NULL`);
    await db.ejecutar(`INSERT OR IGNORE INTO proyecto_miembros (proyecto_id, usuario_id)
      SELECT DISTINCT tb.proyecto_id, b.usuario_id ${participantes}
      JOIN bitacora b ON b.tarea_id = t.id WHERE b.usuario_id IS NOT NULL`);
    await db.ejecutar(`INSERT OR IGNORE INTO proyecto_miembros (proyecto_id, usuario_id)
      SELECT DISTINCT tb.proyecto_id, cm.usuario_id ${participantes}
      JOIN comentarios cm ON cm.tarea_id = t.id WHERE cm.usuario_id IS NOT NULL`);

    await db.ejecutar("PRAGMA user_version = 1");
    console.log("✅ Base de datos actualizada a la versión 1.");
  }
}

// Modo serializado permanente: cada consulta espera a la anterior (las tablas
// ya existen cuando corren las migraciones). La aplicación espera a que las
// migraciones terminen antes de aceptar peticiones.
db.serialize();
db.listo = migrar();

// ── PASO 7: Exportar la conexión para usarla en otros archivos ──────────────
// Con "module.exports" hacemos que otros archivos (como server.js)
// puedan usar esta misma conexión a la base de datos.
module.exports = db;
