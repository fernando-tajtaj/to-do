const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const db = require("./database");
const { enviarCorreoRecuperacion } = require("./mailer");

const { ejecutar, obtener, todos } = db;

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
// Código que se pide al registrarse como Administrador (configurable en .env)
const CODIGO_ADMIN = process.env.CODIGO_ADMIN || "ADMIN123";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secreto_calidad_software_2024",
    resave: false,
    saveUninitialized: false,
  }),
);

/* ==============================================
 * REGLAS DEL NEGOCIO Y VALIDACIONES
 * ============================================== */
const ROLES = ["Administrador", "Miembro/Colaborador"];
const PRIORIDADES = ["Alta", "Media", "Baja"];
const TIPOS_TAREA = ["Tarea", "Bug"];

// Estados del flujo de trabajo. El "tipo" de cada columna define las reglas,
// así renombrar una columna no rompe las transiciones.
const ESTADOS = {
  por_hacer: "Por hacer",
  en_progreso: "En progreso",
  en_revision: "En revisión / QA",
  completado: "Completado",
};
const ORDEN_ESTADOS = `CASE tipo WHEN 'por_hacer' THEN 1 WHEN 'en_progreso' THEN 2
  WHEN 'en_revision' THEN 3 WHEN 'completado' THEN 4 ELSE 5 END`;

// Transiciones permitidas (origen → destinos)
const TRANSICIONES = {
  por_hacer: ["en_progreso"],
  en_progreso: ["en_revision"],
  en_revision: ["completado", "en_progreso"],
  completado: ["en_progreso"], // Reapertura: solo Administrador
};

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REGEX_PASSWORD = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const MENSAJE_PASSWORD =
  "La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.";

const fallo = (res, status, error) => res.status(status).json({ error });
const texto = (valor) => (typeof valor === "string" ? valor.trim() : "");
const entero = (valor) => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fechaValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(valor + "T00:00:00");
  return !isNaN(d) && d.toISOString().startsWith(valor);
}

const esVencida = (t) =>
  t.estado_tipo !== "completado" && !!t.fecha_limite && t.fecha_limite < hoyISO();

function registrar(tareaId, usuarioId, accion) {
  return ejecutar(
    `INSERT INTO bitacora (tarea_id, usuario_id, accion) VALUES (?, ?, ?)`,
    [tareaId, usuarioId, accion],
  );
}

function validarDatosUsuario({ nombre, correo, password, rol }) {
  if (!nombre || !correo || !password || !rol)
    return "Todos los campos son obligatorios.";
  if (nombre.length < 3 || nombre.length > 80)
    return "El nombre debe tener entre 3 y 80 caracteres.";
  if (!REGEX_CORREO.test(correo)) return "El formato del correo no es válido.";
  if (!REGEX_PASSWORD.test(password)) return MENSAJE_PASSWORD;
  if (!ROLES.includes(rol)) return "El rol seleccionado no es válido.";
  return null;
}

async function crearUsuario({ nombre, correo, password, rol }) {
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await ejecutar(
      `INSERT INTO usuarios (nombre, correo, password, rol) VALUES (?, ?, ?, ?)`,
      [nombre, correo, hash, rol],
    );
    return { id: r.lastID };
  } catch (err) {
    if (err.message.includes("UNIQUE"))
      return { error: "Este correo ya está registrado." };
    throw err;
  }
}

/* ==============================================
 * AUTENTICACIÓN Y PERMISOS
 * ============================================== */
async function requiereSesion(req, res, next) {
  if (!req.session.usuarioId) return fallo(res, 401, "Debes iniciar sesión.");
  const usuario = await obtener(
    `SELECT id, nombre, correo, rol, activo FROM usuarios WHERE id = ?`,
    [req.session.usuarioId],
  );
  if (!usuario || !usuario.activo) {
    req.session.destroy(() => {});
    return fallo(res, 401, "Tu sesión ya no es válida. Inicia sesión de nuevo.");
  }
  req.usuario = usuario;
  req.esAdmin = usuario.rol === "Administrador";
  next();
}

function soloAdmin(req, res, next) {
  if (!req.esAdmin)
    return fallo(res, 403, "Solo un Administrador puede realizar esta acción.");
  next();
}

// Cómo encontrar el proyecto al que pertenece cada recurso
const CONSULTA_PROYECTO = {
  proyecto: `SELECT id AS proyecto_id FROM proyectos WHERE id = ?`,
  tablero: `SELECT proyecto_id FROM tableros WHERE id = ?`,
  columna: `SELECT tb.proyecto_id FROM columnas c
            JOIN tableros tb ON c.tablero_id = tb.id WHERE c.id = ?`,
  tarea: `SELECT tb.proyecto_id FROM tareas t JOIN columnas c ON t.estado_id = c.id
          JOIN tableros tb ON c.tablero_id = tb.id WHERE t.id = ?`,
  subtarea: `SELECT tb.proyecto_id FROM subtareas s JOIN tareas t ON s.tarea_id = t.id
             JOIN columnas c ON t.estado_id = c.id JOIN tableros tb ON c.tablero_id = tb.id
             WHERE s.id = ?`,
  item: `SELECT tb.proyecto_id FROM checklist_items i JOIN subtareas s ON i.subtarea_id = s.id
         JOIN tareas t ON s.tarea_id = t.id JOIN columnas c ON t.estado_id = c.id
         JOIN tableros tb ON c.tablero_id = tb.id WHERE i.id = ?`,
};
const NOMBRE_RECURSO = {
  proyecto: "el proyecto",
  tablero: "el tablero",
  columna: "la columna",
  tarea: "la tarea",
  subtarea: "la subtarea",
  item: "el elemento del checklist",
};

async function tieneAcceso(req, proyectoId) {
  if (req.esAdmin) return true;
  return !!(await obtener(
    `SELECT 1 FROM proyecto_miembros WHERE proyecto_id = ? AND usuario_id = ?`,
    [proyectoId, req.usuario.id],
  ));
}

// Middleware: el usuario debe ser miembro del proyecto dueño del recurso
function conAcceso(tipo) {
  return async (req, res, next) => {
    const fila = await obtener(CONSULTA_PROYECTO[tipo], [req.params.id]);
    if (!fila) return fallo(res, 404, `No se encontró ${NOMBRE_RECURSO[tipo]}.`);
    if (!(await tieneAcceso(req, fila.proyecto_id)))
      return fallo(res, 403, "No eres miembro de este proyecto.");
    req.proyectoId = fila.proyecto_id;
    next();
  };
}

// Usuarios a los que se puede asignar una tarea: miembros del proyecto y Administradores
function asignables(proyectoId) {
  return todos(
    `SELECT id, nombre, rol FROM usuarios
     WHERE activo = 1 AND (rol = 'Administrador'
       OR id IN (SELECT usuario_id FROM proyecto_miembros WHERE proyecto_id = ?))
     ORDER BY nombre`,
    [proyectoId],
  );
}

/* ==============================================
 * FASE 1: REGISTRO, LOGIN Y SESIÓN
 * ============================================== */
app.post("/api/registro", async (req, res) => {
  const datos = {
    nombre: texto(req.body.nombre),
    correo: texto(req.body.correo).toLowerCase(),
    password: typeof req.body.password === "string" ? req.body.password : "",
    rol: texto(req.body.rol),
  };
  const error = validarDatosUsuario(datos);
  if (error) return fallo(res, 400, error);
  if (datos.rol === "Administrador" && req.body.codigoAdmin !== CODIGO_ADMIN)
    return fallo(res, 403, "Código de administrador incorrecto.");

  const r = await crearUsuario(datos);
  if (r.error) return fallo(res, 400, r.error);
  res.status(201).json({ mensaje: "Usuario registrado exitosamente.", id: r.id });
});

app.post("/api/login", async (req, res) => {
  const correo = texto(req.body.correo).toLowerCase();
  const password = req.body.password;
  if (!correo || !password)
    return fallo(res, 400, "Correo y contraseña son obligatorios.");
  if (!REGEX_CORREO.test(correo))
    return fallo(res, 400, "El formato del correo no es válido.");

  const usuario = await obtener(`SELECT * FROM usuarios WHERE correo = ?`, [correo]);
  if (!usuario || !(await bcrypt.compare(password, usuario.password)))
    return fallo(res, 400, "Credenciales incorrectas.");
  if (!usuario.activo)
    return fallo(res, 403, "Tu cuenta está desactivada. Contacta a un Administrador.");

  req.session.usuarioId = usuario.id;
  req.session.rol = usuario.rol;
  res.json({
    mensaje: "Inicio de sesión exitoso.",
    usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
  });
});

app.get("/api/sesion", requiereSesion, (req, res) => {
  const { id, nombre, correo, rol } = req.usuario;
  res.json({ id, nombre, correo, rol });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ mensaje: "Sesión cerrada exitosamente." }));
});

/* ==============================================
 * RECUPERACIÓN DE CONTRASEÑA (correo vía BillionMail / Ethereal en pruebas)
 * ============================================== */
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

app.post("/api/recuperar", async (req, res) => {
  const correo = texto(req.body.correo).toLowerCase();
  if (!correo) return fallo(res, 400, "El correo es obligatorio.");
  if (!REGEX_CORREO.test(correo))
    return fallo(res, 400, "El formato del correo no es válido.");

  // Respuesta genérica para no revelar qué correos están registrados
  const respuestaGenerica = {
    mensaje:
      "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.",
  };

  const usuario = await obtener(
    `SELECT id, nombre, correo FROM usuarios WHERE correo = ? AND activo = 1`,
    [correo],
  );
  if (!usuario) return res.json(respuestaGenerica);

  const token = crypto.randomBytes(32).toString("hex");
  const expira = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

  // Invalida tokens anteriores del usuario y guarda el nuevo
  await ejecutar(
    `UPDATE recuperaciones SET usado = 1 WHERE usuario_id = ? AND usado = 0`,
    [usuario.id],
  );
  await ejecutar(
    `INSERT INTO recuperaciones (usuario_id, token_hash, expira) VALUES (?, ?, ?)`,
    [usuario.id, hashToken(token), expira],
  );

  const enlace = `${APP_URL}/restablecer.html?token=${token}`;
  try {
    const vistaPrevia = await enviarCorreoRecuperacion(
      usuario.correo,
      usuario.nombre,
      enlace,
    );
    // En modo prueba (sin .env) se devuelve la URL para ver el correo
    res.json(vistaPrevia ? { ...respuestaGenerica, vistaPrevia } : respuestaGenerica);
  } catch (error) {
    console.error("Error al enviar correo:", error.message);
    fallo(res, 500, "No se pudo enviar el correo. Intenta de nuevo más tarde.");
  }
});

app.post("/api/restablecer", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)
    return fallo(res, 400, "Token y nueva contraseña son obligatorios.");
  if (!REGEX_PASSWORD.test(password)) return fallo(res, 400, MENSAJE_PASSWORD);

  const registro = await obtener(
    `SELECT * FROM recuperaciones WHERE token_hash = ? AND usado = 0`,
    [hashToken(String(token))],
  );
  if (!registro || new Date(registro.expira) < new Date())
    return fallo(res, 400, "El enlace es inválido o ha expirado.");

  const hash = await bcrypt.hash(password, 10);
  await ejecutar(`UPDATE usuarios SET password = ? WHERE id = ?`, [
    hash,
    registro.usuario_id,
  ]);
  await ejecutar(`UPDATE recuperaciones SET usado = 1 WHERE id = ?`, [registro.id]);
  res.json({ mensaje: "Contraseña actualizada correctamente." });
});

/* ==============================================
 * FASE 2: GESTIÓN DE USUARIOS (Administrador)
 * ============================================== */
app.get("/api/usuarios", requiereSesion, async (req, res) => {
  if (!req.esAdmin)
    return res.json(
      await todos(`SELECT id, nombre, rol FROM usuarios WHERE activo = 1 ORDER BY nombre`),
    );
  const usuarios = await todos(
    `SELECT u.id, u.nombre, u.correo, u.rol, u.activo,
       (SELECT GROUP_CONCAT(p.nombre, ', ') FROM proyecto_miembros m
          JOIN proyectos p ON p.id = m.proyecto_id WHERE m.usuario_id = u.id) AS proyectos,
       (SELECT COUNT(*) FROM tareas t WHERE t.responsable_id = u.id) AS tareas_asignadas
     FROM usuarios u ORDER BY u.nombre`,
  );
  res.json(usuarios);
});

app.post("/api/usuarios", requiereSesion, soloAdmin, async (req, res) => {
  const datos = {
    nombre: texto(req.body.nombre),
    correo: texto(req.body.correo).toLowerCase(),
    password: typeof req.body.password === "string" ? req.body.password : "",
    rol: texto(req.body.rol),
  };
  const error = validarDatosUsuario(datos);
  if (error) return fallo(res, 400, error);
  const r = await crearUsuario(datos);
  if (r.error) return fallo(res, 400, r.error);
  res.status(201).json({ mensaje: "Usuario creado.", id: r.id });
});

app.put("/api/usuarios/:id", requiereSesion, soloAdmin, async (req, res) => {
  const id = entero(req.params.id);
  const usuario = await obtener(`SELECT * FROM usuarios WHERE id = ?`, [id]);
  if (!usuario) return fallo(res, 404, "No se encontró el usuario.");

  const nombre = req.body.nombre !== undefined ? texto(req.body.nombre) : usuario.nombre;
  const rol = req.body.rol !== undefined ? texto(req.body.rol) : usuario.rol;
  const activo = req.body.activo !== undefined ? (req.body.activo ? 1 : 0) : usuario.activo;

  if (nombre.length < 3 || nombre.length > 80)
    return fallo(res, 400, "El nombre debe tener entre 3 y 80 caracteres.");
  if (!ROLES.includes(rol)) return fallo(res, 400, "El rol seleccionado no es válido.");
  if (id === req.usuario.id && (rol !== usuario.rol || !activo))
    return fallo(res, 400, "No puedes cambiar tu propio rol ni desactivar tu cuenta.");

  await ejecutar(`UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?`, [
    nombre,
    rol,
    activo,
    id,
  ]);
  res.json({ mensaje: "Usuario actualizado." });
});

/* ==============================================
 * FASE 3: PROYECTOS, MIEMBROS Y TABLEROS
 * ============================================== */
// Tareas con su estado y ubicación, filtradas a los proyectos del usuario
function tareasVisibles(req) {
  return todos(
    `SELECT t.id, t.titulo, t.tipo, t.prioridad, t.fecha_limite, t.responsable_id,
            c.tipo AS estado_tipo, c.nombre AS estado_nombre,
            tb.id AS tablero_id, tb.nombre AS tablero_nombre,
            p.id AS proyecto_id, p.nombre AS proyecto_nombre,
            u.nombre AS responsable_nombre, u.rol AS responsable_rol
     FROM tareas t
     JOIN columnas c  ON t.estado_id = c.id
     JOIN tableros tb ON c.tablero_id = tb.id
     JOIN proyectos p ON tb.proyecto_id = p.id
     LEFT JOIN usuarios u ON t.responsable_id = u.id
     ${req.esAdmin ? "" : "WHERE p.id IN (SELECT proyecto_id FROM proyecto_miembros WHERE usuario_id = ?)"}`,
    req.esAdmin ? [] : [req.usuario.id],
  );
}

function resumir(tareas) {
  const r = {
    total: tareas.length,
    por_hacer: 0,
    en_progreso: 0,
    en_revision: 0,
    completado: 0,
    vencidas: 0,
    bugs_abiertos: 0,
  };
  for (const t of tareas) {
    if (r[t.estado_tipo] !== undefined) r[t.estado_tipo]++;
    if (esVencida(t)) r.vencidas++;
    if (t.tipo === "Bug" && t.estado_tipo !== "completado") r.bugs_abiertos++;
  }
  r.avance = r.total ? Math.round((r.completado / r.total) * 100) : 0;
  return r;
}

async function crearTablero(proyectoId, nombre) {
  const t = await ejecutar(`INSERT INTO tableros (nombre, proyecto_id) VALUES (?, ?)`, [
    nombre,
    proyectoId,
  ]);
  let orden = 1;
  for (const [tipo, nombreColumna] of Object.entries(ESTADOS))
    await ejecutar(
      `INSERT INTO columnas (nombre, tablero_id, tipo, orden) VALUES (?, ?, ?, ?)`,
      [nombreColumna, t.lastID, tipo, orden++],
    );
  return t.lastID;
}

// Borra tareas (y todo lo que depende de ellas) que cumplan la condición
async function eliminarTareas(condicion, params) {
  const ids = `SELECT id FROM tareas WHERE ${condicion}`;
  await ejecutar(
    `DELETE FROM checklist_items WHERE subtarea_id IN
       (SELECT id FROM subtareas WHERE tarea_id IN (${ids}))`,
    params,
  );
  await ejecutar(`DELETE FROM subtareas WHERE tarea_id IN (${ids})`, params);
  await ejecutar(`DELETE FROM comentarios WHERE tarea_id IN (${ids})`, params);
  await ejecutar(`DELETE FROM bitacora WHERE tarea_id IN (${ids})`, params);
  await ejecutar(`DELETE FROM tareas WHERE ${condicion}`, params);
}

async function validarMiembros(lista) {
  const ids = [...new Set((Array.isArray(lista) ? lista : []).map(entero))].filter(Boolean);
  if (!ids.length) return [];
  const existentes = await todos(
    `SELECT id FROM usuarios WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return existentes.map((u) => u.id);
}

function validarProyecto(body) {
  const nombre = texto(body.nombre);
  const descripcion = texto(body.descripcion);
  if (!nombre) return { error: "El nombre del proyecto es obligatorio." };
  if (nombre.length > 100) return { error: "El nombre no puede superar 100 caracteres." };
  if (descripcion.length > 500)
    return { error: "La descripción no puede superar 500 caracteres." };
  return { nombre, descripcion };
}

app.get("/api/proyectos", requiereSesion, async (req, res) => {
  const proyectos = await todos(
    `SELECT p.id, p.nombre, p.descripcion, p.creado_por, u.nombre AS creador_nombre,
       (SELECT COUNT(*) FROM proyecto_miembros m WHERE m.proyecto_id = p.id) AS total_miembros
     FROM proyectos p LEFT JOIN usuarios u ON p.creado_por = u.id
     ${req.esAdmin ? "" : "WHERE p.id IN (SELECT proyecto_id FROM proyecto_miembros WHERE usuario_id = ?)"}
     ORDER BY p.nombre`,
    req.esAdmin ? [] : [req.usuario.id],
  );
  const tableros = await todos(`SELECT id, nombre, proyecto_id FROM tableros ORDER BY id`);
  const tareas = await tareasVisibles(req);
  for (const p of proyectos) {
    p.tableros = tableros.filter((t) => t.proyecto_id === p.id);
    p.resumen = resumir(tareas.filter((t) => t.proyecto_id === p.id));
  }
  res.json(proyectos);
});

app.post("/api/proyectos", requiereSesion, soloAdmin, async (req, res) => {
  const datos = validarProyecto(req.body);
  if (datos.error) return fallo(res, 400, datos.error);

  const r = await ejecutar(
    `INSERT INTO proyectos (nombre, descripcion, creado_por) VALUES (?, ?, ?)`,
    [datos.nombre, datos.descripcion, req.usuario.id],
  );
  const miembros = new Set([req.usuario.id, ...(await validarMiembros(req.body.miembros))]);
  for (const usuarioId of miembros)
    await ejecutar(
      `INSERT OR IGNORE INTO proyecto_miembros (proyecto_id, usuario_id) VALUES (?, ?)`,
      [r.lastID, usuarioId],
    );
  const tableroId = await crearTablero(r.lastID, "Tablero principal");
  res.status(201).json({ mensaje: "Proyecto creado.", id: r.lastID, tableroId });
});

app.put("/api/proyectos/:id", requiereSesion, soloAdmin, conAcceso("proyecto"), async (req, res) => {
  const datos = validarProyecto(req.body);
  if (datos.error) return fallo(res, 400, datos.error);
  await ejecutar(`UPDATE proyectos SET nombre = ?, descripcion = ? WHERE id = ?`, [
    datos.nombre,
    datos.descripcion,
    req.proyectoId,
  ]);
  res.json({ mensaje: "Proyecto actualizado." });
});

app.delete("/api/proyectos/:id", requiereSesion, soloAdmin, conAcceso("proyecto"), async (req, res) => {
  const id = req.proyectoId;
  await eliminarTareas(
    `estado_id IN (SELECT c.id FROM columnas c JOIN tableros tb ON c.tablero_id = tb.id
                   WHERE tb.proyecto_id = ?)`,
    [id],
  );
  await ejecutar(
    `DELETE FROM columnas WHERE tablero_id IN (SELECT id FROM tableros WHERE proyecto_id = ?)`,
    [id],
  );
  await ejecutar(`DELETE FROM tableros WHERE proyecto_id = ?`, [id]);
  await ejecutar(`DELETE FROM proyecto_miembros WHERE proyecto_id = ?`, [id]);
  await ejecutar(`DELETE FROM proyectos WHERE id = ?`, [id]);
  res.json({ mensaje: "Proyecto eliminado." });
});

app.get("/api/proyectos/:id/miembros", requiereSesion, conAcceso("proyecto"), async (req, res) => {
  res.json(
    await todos(
      `SELECT u.id, u.nombre, u.rol, u.activo FROM proyecto_miembros m
       JOIN usuarios u ON u.id = m.usuario_id WHERE m.proyecto_id = ? ORDER BY u.nombre`,
      [req.proyectoId],
    ),
  );
});

app.put("/api/proyectos/:id/miembros", requiereSesion, soloAdmin, conAcceso("proyecto"), async (req, res) => {
  const miembros = await validarMiembros(req.body.usuarios);
  await ejecutar(`DELETE FROM proyecto_miembros WHERE proyecto_id = ?`, [req.proyectoId]);
  for (const usuarioId of miembros)
    await ejecutar(`INSERT INTO proyecto_miembros (proyecto_id, usuario_id) VALUES (?, ?)`, [
      req.proyectoId,
      usuarioId,
    ]);
  res.json({ mensaje: "Miembros actualizados.", total: miembros.length });
});

app.post("/api/proyectos/:id/tableros", requiereSesion, soloAdmin, conAcceso("proyecto"), async (req, res) => {
  const nombre = texto(req.body.nombre);
  if (!nombre) return fallo(res, 400, "El nombre del tablero es obligatorio.");
  if (nombre.length > 80) return fallo(res, 400, "El nombre no puede superar 80 caracteres.");
  const id = await crearTablero(req.proyectoId, nombre);
  res.status(201).json({ mensaje: "Tablero creado.", id });
});

// Todo lo necesario para pintar un tablero Kanban en una sola petición
app.get("/api/tableros/:id", requiereSesion, conAcceso("tablero"), async (req, res) => {
  const tablero = await obtener(
    `SELECT tb.id, tb.nombre, tb.proyecto_id, p.nombre AS proyecto_nombre
     FROM tableros tb JOIN proyectos p ON tb.proyecto_id = p.id WHERE tb.id = ?`,
    [req.params.id],
  );
  const columnas = await todos(
    `SELECT id, nombre, tipo, orden FROM columnas WHERE tablero_id = ?
     ORDER BY ${ORDEN_ESTADOS}, orden, id`,
    [tablero.id],
  );
  const tareas = await todos(
    `SELECT t.*, c.tipo AS estado_tipo, u.nombre AS responsable_nombre,
       (SELECT COUNT(*) FROM subtareas s WHERE s.tarea_id = t.id) AS total_subtareas,
       (SELECT COUNT(*) FROM subtareas s WHERE s.tarea_id = t.id AND s.completada = 1) AS subtareas_completadas,
       (SELECT COUNT(*) FROM comentarios cm WHERE cm.tarea_id = t.id) AS total_comentarios
     FROM tareas t JOIN columnas c ON t.estado_id = c.id
     LEFT JOIN usuarios u ON t.responsable_id = u.id
     WHERE c.tablero_id = ? ORDER BY t.id`,
    [tablero.id],
  );
  tareas.forEach((t) => (t.vencida = esVencida(t)));
  const otrosTableros = await todos(
    `SELECT id, nombre FROM tableros WHERE proyecto_id = ? ORDER BY id`,
    [tablero.proyecto_id],
  );
  res.json({
    tablero,
    columnas,
    tareas,
    tableros: otrosTableros,
    usuarios: await asignables(tablero.proyecto_id),
    estados: ESTADOS,
  });
});

app.put("/api/tableros/:id", requiereSesion, soloAdmin, conAcceso("tablero"), async (req, res) => {
  const nombre = texto(req.body.nombre);
  if (!nombre) return fallo(res, 400, "El nombre del tablero es obligatorio.");
  if (nombre.length > 80) return fallo(res, 400, "El nombre no puede superar 80 caracteres.");
  await ejecutar(`UPDATE tableros SET nombre = ? WHERE id = ?`, [nombre, req.params.id]);
  res.json({ mensaje: "Tablero actualizado." });
});

app.delete("/api/tableros/:id", requiereSesion, soloAdmin, conAcceso("tablero"), async (req, res) => {
  const id = req.params.id;
  await eliminarTareas(`estado_id IN (SELECT id FROM columnas WHERE tablero_id = ?)`, [id]);
  await ejecutar(`DELETE FROM columnas WHERE tablero_id = ?`, [id]);
  await ejecutar(`DELETE FROM tableros WHERE id = ?`, [id]);
  res.json({ mensaje: "Tablero eliminado." });
});

/* ==============================================
 * FASE 4: COLUMNAS (Estados del tablero)
 * ============================================== */
app.post("/api/tableros/:id/columnas", requiereSesion, soloAdmin, conAcceso("tablero"), async (req, res) => {
  const nombre = texto(req.body.nombre);
  const tipo = texto(req.body.tipo);
  if (!nombre) return fallo(res, 400, "El nombre de la columna es obligatorio.");
  if (nombre.length > 50) return fallo(res, 400, "El nombre no puede superar 50 caracteres.");
  if (!ESTADOS[tipo]) return fallo(res, 400, "Selecciona a qué estado pertenece la columna.");
  const { max } = await obtener(
    `SELECT COALESCE(MAX(orden), 0) AS max FROM columnas WHERE tablero_id = ?`,
    [req.params.id],
  );
  await ejecutar(`INSERT INTO columnas (nombre, tablero_id, tipo, orden) VALUES (?, ?, ?, ?)`, [
    nombre,
    req.params.id,
    tipo,
    max + 1,
  ]);
  res.status(201).json({ mensaje: "Columna creada." });
});

app.put("/api/columnas/:id", requiereSesion, soloAdmin, conAcceso("columna"), async (req, res) => {
  const nombre = texto(req.body.nombre);
  if (!nombre) return fallo(res, 400, "El nombre de la columna es obligatorio.");
  if (nombre.length > 50) return fallo(res, 400, "El nombre no puede superar 50 caracteres.");
  await ejecutar(`UPDATE columnas SET nombre = ? WHERE id = ?`, [nombre, req.params.id]);
  res.json({ mensaje: "Columna actualizada." });
});

app.delete("/api/columnas/:id", requiereSesion, soloAdmin, conAcceso("columna"), async (req, res) => {
  const columna = await obtener(`SELECT * FROM columnas WHERE id = ?`, [req.params.id]);
  const { total } = await obtener(`SELECT COUNT(*) AS total FROM tareas WHERE estado_id = ?`, [
    columna.id,
  ]);
  if (total > 0)
    return fallo(res, 400, `La columna tiene ${total} tarea(s). Muévelas antes de eliminarla.`);
  const { mismas } = await obtener(
    `SELECT COUNT(*) AS mismas FROM columnas WHERE tablero_id = ? AND tipo = ?`,
    [columna.tablero_id, columna.tipo],
  );
  if (mismas <= 1)
    return fallo(
      res,
      400,
      `El tablero debe conservar al menos una columna de "${ESTADOS[columna.tipo]}".`,
    );
  await ejecutar(`DELETE FROM columnas WHERE id = ?`, [columna.id]);
  res.json({ mensaje: "Columna eliminada." });
});

/* ==============================================
 * FASE 5: TAREAS Y TRANSICIONES DE ESTADO
 * ============================================== */
function normalizarEtiquetas(valor) {
  const lista = (Array.isArray(valor) ? valor : String(valor || "").split(","))
    .map((e) => String(e).trim())
    .filter(Boolean);
  // Quita repetidas sin importar mayúsculas, conservando la primera escritura
  const vistas = new Set();
  const unicas = lista.filter((e) => !vistas.has(e.toLowerCase()) && vistas.add(e.toLowerCase()));
  if (unicas.length > 8) return { error: "Máximo 8 etiquetas por tarea." };
  if (unicas.some((e) => e.length > 30))
    return { error: "Cada etiqueta puede tener como máximo 30 caracteres." };
  return { valor: unicas.join(", ") };
}

// Valida los datos de una tarea; "actual" son los valores previos al editar
async function validarTarea(body, proyectoId, actual = {}) {
  const valor = (campo) => (body[campo] !== undefined ? body[campo] : actual[campo]);

  const titulo = texto(valor("titulo"));
  const descripcion = texto(valor("descripcion"));
  const prioridad = texto(valor("prioridad"));
  const tipo = texto(valor("tipo")) || "Tarea";
  const fechaInicio = texto(valor("fecha_inicio")) || null;
  const fechaLimite = texto(valor("fecha_limite")) || null;
  const responsableCrudo = valor("responsable_id");
  const responsableId =
    responsableCrudo === null || responsableCrudo === "" || responsableCrudo === undefined
      ? null
      : entero(responsableCrudo);

  if (!titulo) return { error: "El título es obligatorio." };
  if (titulo.length > 150) return { error: "El título no puede superar 150 caracteres." };
  if (descripcion.length > 2000)
    return { error: "La descripción no puede superar 2000 caracteres." };
  if (!PRIORIDADES.includes(prioridad))
    return { error: "La prioridad debe ser Alta, Media o Baja." };
  if (!TIPOS_TAREA.includes(tipo)) return { error: "El tipo debe ser Tarea o Bug." };
  if (fechaInicio && !fechaValida(fechaInicio))
    return { error: "La fecha de inicio no es válida." };
  if (fechaLimite && !fechaValida(fechaLimite))
    return { error: "La fecha límite no es válida." };
  if (fechaInicio && fechaLimite && fechaLimite < fechaInicio)
    return { error: "La fecha límite no puede ser anterior a la fecha de inicio." };

  const etiquetas = normalizarEtiquetas(valor("etiquetas"));
  if (etiquetas.error) return etiquetas;

  if (responsableCrudo && !responsableId) return { error: "El responsable no es válido." };
  if (responsableId) {
    const permitidos = await asignables(proyectoId);
    if (!permitidos.some((u) => u.id === responsableId))
      return { error: "El responsable debe ser miembro del proyecto." };
  }

  return {
    titulo,
    descripcion,
    prioridad,
    tipo,
    etiquetas: etiquetas.valor,
    responsable_id: responsableId,
    fecha_inicio: fechaInicio,
    fecha_limite: fechaLimite,
  };
}

async function obtenerTarea(id) {
  return obtener(
    `SELECT t.*, c.tipo AS estado_tipo, c.nombre AS estado_nombre, c.tablero_id,
            u.nombre AS responsable_nombre, cr.nombre AS creador_nombre
     FROM tareas t JOIN columnas c ON t.estado_id = c.id
     LEFT JOIN usuarios u  ON t.responsable_id = u.id
     LEFT JOIN usuarios cr ON t.creado_por = cr.id
     WHERE t.id = ?`,
    [id],
  );
}

async function tareaCerrada(res, tareaId) {
  const t = await obtenerTarea(tareaId);
  if (t.estado_tipo === "completado") {
    fallo(res, 400, "La tarea está completada y cerrada. Un Administrador debe reabrirla para modificarla.");
    return true;
  }
  return false;
}

app.post("/api/tableros/:id/tareas", requiereSesion, conAcceso("tablero"), async (req, res) => {
  const datos = await validarTarea(req.body, req.proyectoId);
  if (datos.error) return fallo(res, 400, datos.error);

  // Toda tarea nueva nace en "Por hacer" (Backlog)
  const columna = await obtener(
    `SELECT id, nombre FROM columnas WHERE tablero_id = ? AND tipo = 'por_hacer'
     ORDER BY orden, id LIMIT 1`,
    [req.params.id],
  );
  if (!columna) return fallo(res, 400, 'El tablero no tiene una columna de "Por hacer".');

  const r = await ejecutar(
    `INSERT INTO tareas (titulo, descripcion, prioridad, tipo, etiquetas, estado_id,
       responsable_id, fecha_inicio, fecha_limite, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      datos.titulo,
      datos.descripcion,
      datos.prioridad,
      datos.tipo,
      datos.etiquetas,
      columna.id,
      datos.responsable_id,
      datos.fecha_inicio,
      datos.fecha_limite,
      req.usuario.id,
    ],
  );
  let accion = `Creó ${datos.tipo === "Bug" ? "el bug" : "la tarea"} en "${columna.nombre}"`;
  if (datos.responsable_id) {
    const u = await obtener(`SELECT nombre FROM usuarios WHERE id = ?`, [datos.responsable_id]);
    accion += ` y la asignó a ${u.nombre}`;
  }
  await registrar(r.lastID, req.usuario.id, accion);
  res.status(201).json({ mensaje: "Tarea creada.", id: r.lastID });
});

// Detalle completo: tarea, subtareas con checklist, comentarios y bitácora
app.get("/api/tareas/:id", requiereSesion, conAcceso("tarea"), async (req, res) => {
  const tarea = await obtenerTarea(req.params.id);
  tarea.vencida = esVencida(tarea);
  const subtareas = await todos(
    `SELECT * FROM subtareas WHERE tarea_id = ? ORDER BY id`,
    [tarea.id],
  );
  const items = await todos(
    `SELECT i.* FROM checklist_items i JOIN subtareas s ON i.subtarea_id = s.id
     WHERE s.tarea_id = ? ORDER BY i.id`,
    [tarea.id],
  );
  subtareas.forEach((s) => (s.items = items.filter((i) => i.subtarea_id === s.id)));
  const comentarios = await todos(
    `SELECT c.id, c.texto, c.fecha, u.nombre, u.rol FROM comentarios c
     LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.tarea_id = ? ORDER BY c.fecha DESC, c.id DESC`,
    [tarea.id],
  );
  const bitacora = await todos(
    `SELECT b.id, b.accion, b.fecha, u.nombre FROM bitacora b
     LEFT JOIN usuarios u ON b.usuario_id = u.id WHERE b.tarea_id = ? ORDER BY b.fecha DESC, b.id DESC`,
    [tarea.id],
  );
  res.json({ tarea, subtareas, comentarios, bitacora });
});

const ETIQUETAS_CAMPO = {
  titulo: "título",
  descripcion: "descripción",
  prioridad: "prioridad",
  tipo: "tipo",
  etiquetas: "etiquetas",
  responsable_id: "responsable",
  fecha_inicio: "fecha de inicio",
  fecha_limite: "fecha límite",
};

app.put("/api/tareas/:id", requiereSesion, conAcceso("tarea"), async (req, res) => {
  const actual = await obtenerTarea(req.params.id);
  if (actual.estado_tipo === "completado" && !req.esAdmin)
    return fallo(res, 400, "La tarea está completada y cerrada. Solo un Administrador puede editarla.");

  const datos = await validarTarea(req.body, req.proyectoId, actual);
  if (datos.error) return fallo(res, 400, datos.error);
  if (!datos.responsable_id && actual.estado_tipo !== "por_hacer")
    return fallo(res, 400, `Una tarea en "${ESTADOS[actual.estado_tipo]}" debe tener un responsable.`);

  // Detalle de los cambios para la bitácora
  const cambios = [];
  for (const campo of Object.keys(ETIQUETAS_CAMPO)) {
    const antes = actual[campo] ?? null;
    const despues = datos[campo] ?? null;
    if (String(antes ?? "") === String(despues ?? "")) continue;
    if (campo === "descripcion") cambios.push("descripción");
    else if (campo === "responsable_id") {
      const u = despues ? await obtener(`SELECT nombre FROM usuarios WHERE id = ?`, [despues]) : null;
      cambios.push(`responsable: ${actual.responsable_nombre || "sin asignar"} → ${u ? u.nombre : "sin asignar"}`);
    } else cambios.push(`${ETIQUETAS_CAMPO[campo]}: ${antes || "vacío"} → ${despues || "vacío"}`);
  }
  if (!cambios.length) return res.json({ mensaje: "No hubo cambios." });

  await ejecutar(
    `UPDATE tareas SET titulo = ?, descripcion = ?, prioridad = ?, tipo = ?, etiquetas = ?,
       responsable_id = ?, fecha_inicio = ?, fecha_limite = ? WHERE id = ?`,
    [
      datos.titulo,
      datos.descripcion,
      datos.prioridad,
      datos.tipo,
      datos.etiquetas,
      datos.responsable_id,
      datos.fecha_inicio,
      datos.fecha_limite,
      actual.id,
    ],
  );
  await registrar(actual.id, req.usuario.id, `Editó ${cambios.join("; ")}`);
  res.json({ mensaje: "Tarea actualizada." });
});

// Revisa si la tarea puede pasar de su estado actual al destino
async function validarTransicion(req, tarea, destino, motivo) {
  const origen = tarea.estado_tipo;
  if (origen === destino.tipo) return null; // Mover entre columnas del mismo estado

  if (!TRANSICIONES[origen].includes(destino.tipo)) {
    const opciones = TRANSICIONES[origen].map((t) => `"${ESTADOS[t]}"`).join(" o ");
    return `No se puede pasar de "${ESTADOS[origen]}" a "${ESTADOS[destino.tipo]}". Desde "${ESTADOS[origen]}" solo puede ir a ${opciones}.`;
  }

  if (origen === "por_hacer" && !tarea.responsable_id)
    return "Asigna un responsable antes de pasar la tarea a En progreso.";

  if (origen === "en_progreso") {
    if (!req.esAdmin && tarea.responsable_id !== req.usuario.id)
      return `Solo el responsable (${tarea.responsable_nombre}) o un Administrador puede enviar la tarea a revisión.`;
    const { total, completadas } = await obtener(
      `SELECT COUNT(*) AS total, COALESCE(SUM(completada = 1), 0) AS completadas
       FROM subtareas WHERE tarea_id = ?`,
      [tarea.id],
    );
    if (total === 0)
      return "La tarea necesita al menos una subtarea para demostrar su avance antes de ir a revisión.";
    if (completadas < total)
      return `El avance no está completo: faltan ${total - completadas} de ${total} subtareas (${Math.round((completadas / total) * 100)}%).`;
  }

  if (origen === "en_revision" && destino.tipo === "en_progreso" && !motivo)
    return "Describe el defecto encontrado para regresar la tarea a En progreso.";

  if (origen === "completado") {
    if (!req.esAdmin) return "Completado es un estado final. Solo un Administrador puede reabrir la tarea.";
    if (!motivo) return "Indica el motivo para reabrir la tarea.";
  }
  return null;
}

app.put("/api/tareas/:id/estado", requiereSesion, conAcceso("tarea"), async (req, res) => {
  const tarea = await obtenerTarea(req.params.id);
  const destino = await obtener(`SELECT * FROM columnas WHERE id = ?`, [
    entero(req.body.columna_id),
  ]);
  if (!destino || destino.tablero_id !== tarea.tablero_id)
    return fallo(res, 404, "La columna destino no existe en este tablero.");
  if (destino.id === tarea.estado_id) return res.json({ mensaje: "Sin cambios." });

  const motivo = texto(req.body.motivo).slice(0, 1000);
  const error = await validarTransicion(req, tarea, destino, motivo);
  if (error) return fallo(res, 400, error);

  const campos = ["estado_id = ?"];
  const valores = [destino.id];
  if (destino.tipo === "en_progreso" && !tarea.fecha_inicio) {
    campos.push("fecha_inicio = ?");
    valores.push(hoyISO());
  }
  if (destino.tipo === "completado") campos.push("fecha_cierre = CURRENT_TIMESTAMP");
  else if (tarea.estado_tipo === "completado") campos.push("fecha_cierre = NULL");
  await ejecutar(`UPDATE tareas SET ${campos.join(", ")} WHERE id = ?`, [...valores, tarea.id]);

  let accion = `Movió la tarea de "${tarea.estado_nombre}" a "${destino.nombre}"`;
  if (destino.tipo === "completado") accion += " (cerrada)";
  if (motivo) {
    accion += `. Motivo: ${motivo}`;
    const prefijo = tarea.estado_tipo === "completado" ? "Reapertura" : "Defecto encontrado en revisión";
    await ejecutar(`INSERT INTO comentarios (texto, tarea_id, usuario_id) VALUES (?, ?, ?)`, [
      `${prefijo}: ${motivo}`,
      tarea.id,
      req.usuario.id,
    ]);
  }
  await registrar(tarea.id, req.usuario.id, accion);
  res.json({ mensaje: `Tarea movida a "${destino.nombre}".` });
});

app.delete("/api/tareas/:id", requiereSesion, soloAdmin, conAcceso("tarea"), async (req, res) => {
  await eliminarTareas("id = ?", [req.params.id]);
  res.json({ mensaje: "Tarea eliminada." });
});

/* ==============================================
 * FASE 6: SUBTAREAS Y CHECKLIST
 * ============================================== */
app.post("/api/tareas/:id/subtareas", requiereSesion, conAcceso("tarea"), async (req, res) => {
  if (await tareaCerrada(res, req.params.id)) return;
  const titulo = texto(req.body.titulo);
  if (!titulo) return fallo(res, 400, "El título de la subtarea es obligatorio.");
  if (titulo.length > 150) return fallo(res, 400, "El título no puede superar 150 caracteres.");
  const r = await ejecutar(`INSERT INTO subtareas (titulo, tarea_id) VALUES (?, ?)`, [
    titulo,
    req.params.id,
  ]);
  await registrar(req.params.id, req.usuario.id, `Agregó la subtarea "${titulo}"`);
  res.status(201).json({ mensaje: "Subtarea creada.", id: r.lastID });
});

app.put("/api/subtareas/:id", requiereSesion, conAcceso("subtarea"), async (req, res) => {
  const sub = await obtener(`SELECT * FROM subtareas WHERE id = ?`, [req.params.id]);
  if (await tareaCerrada(res, sub.tarea_id)) return;

  if (req.body.titulo !== undefined) {
    const titulo = texto(req.body.titulo);
    if (!titulo) return fallo(res, 400, "El título de la subtarea es obligatorio.");
    if (titulo.length > 150) return fallo(res, 400, "El título no puede superar 150 caracteres.");
    if (titulo !== sub.titulo) {
      await ejecutar(`UPDATE subtareas SET titulo = ? WHERE id = ?`, [titulo, sub.id]);
      await registrar(sub.tarea_id, req.usuario.id, `Renombró la subtarea "${sub.titulo}" a "${titulo}"`);
      sub.titulo = titulo;
    }
  }

  if (req.body.completada !== undefined) {
    const completada = req.body.completada ? 1 : 0;
    if (completada && !sub.completada) {
      const { pendientes } = await obtener(
        `SELECT COUNT(*) AS pendientes FROM checklist_items WHERE subtarea_id = ? AND completado = 0`,
        [sub.id],
      );
      if (pendientes > 0)
        return fallo(res, 400, `Completa los ${pendientes} elemento(s) pendientes del checklist de esta subtarea primero.`);
    }
    if (completada !== sub.completada) {
      await ejecutar(`UPDATE subtareas SET completada = ? WHERE id = ?`, [completada, sub.id]);
      await registrar(
        sub.tarea_id,
        req.usuario.id,
        completada ? `Completó la subtarea "${sub.titulo}"` : `Marcó como pendiente la subtarea "${sub.titulo}"`,
      );
    }
  }
  res.json({ mensaje: "Subtarea actualizada." });
});

app.delete("/api/subtareas/:id", requiereSesion, conAcceso("subtarea"), async (req, res) => {
  const sub = await obtener(`SELECT * FROM subtareas WHERE id = ?`, [req.params.id]);
  if (await tareaCerrada(res, sub.tarea_id)) return;
  await ejecutar(`DELETE FROM checklist_items WHERE subtarea_id = ?`, [sub.id]);
  await ejecutar(`DELETE FROM subtareas WHERE id = ?`, [sub.id]);
  await registrar(sub.tarea_id, req.usuario.id, `Eliminó la subtarea "${sub.titulo}"`);
  res.json({ mensaje: "Subtarea eliminada." });
});

// Si la subtarea estaba completada y su checklist vuelve a tener pendientes, se reabre
async function reabrirSiCorresponde(subtareaId, usuarioId) {
  const sub = await obtener(`SELECT * FROM subtareas WHERE id = ?`, [subtareaId]);
  const { pendientes } = await obtener(
    `SELECT COUNT(*) AS pendientes FROM checklist_items WHERE subtarea_id = ? AND completado = 0`,
    [subtareaId],
  );
  if (sub.completada && pendientes > 0) {
    await ejecutar(`UPDATE subtareas SET completada = 0 WHERE id = ?`, [subtareaId]);
    await registrar(sub.tarea_id, usuarioId, `La subtarea "${sub.titulo}" volvió a pendiente (checklist incompleto)`);
  }
}

app.post("/api/subtareas/:id/items", requiereSesion, conAcceso("subtarea"), async (req, res) => {
  const sub = await obtener(`SELECT * FROM subtareas WHERE id = ?`, [req.params.id]);
  if (await tareaCerrada(res, sub.tarea_id)) return;
  const textoItem = texto(req.body.texto);
  if (!textoItem) return fallo(res, 400, "El texto del elemento es obligatorio.");
  if (textoItem.length > 150) return fallo(res, 400, "El texto no puede superar 150 caracteres.");
  const r = await ejecutar(`INSERT INTO checklist_items (texto, subtarea_id) VALUES (?, ?)`, [
    textoItem,
    sub.id,
  ]);
  await reabrirSiCorresponde(sub.id, req.usuario.id);
  res.status(201).json({ mensaje: "Elemento agregado.", id: r.lastID });
});

app.put("/api/items/:id", requiereSesion, conAcceso("item"), async (req, res) => {
  const item = await obtener(
    `SELECT i.*, s.tarea_id FROM checklist_items i JOIN subtareas s ON i.subtarea_id = s.id WHERE i.id = ?`,
    [req.params.id],
  );
  if (await tareaCerrada(res, item.tarea_id)) return;
  const textoItem = req.body.texto !== undefined ? texto(req.body.texto) : item.texto;
  if (!textoItem) return fallo(res, 400, "El texto del elemento es obligatorio.");
  const completado = req.body.completado !== undefined ? (req.body.completado ? 1 : 0) : item.completado;
  await ejecutar(`UPDATE checklist_items SET texto = ?, completado = ? WHERE id = ?`, [
    textoItem.slice(0, 150),
    completado,
    item.id,
  ]);
  await reabrirSiCorresponde(item.subtarea_id, req.usuario.id);
  res.json({ mensaje: "Elemento actualizado." });
});

app.delete("/api/items/:id", requiereSesion, conAcceso("item"), async (req, res) => {
  const item = await obtener(
    `SELECT i.*, s.tarea_id FROM checklist_items i JOIN subtareas s ON i.subtarea_id = s.id WHERE i.id = ?`,
    [req.params.id],
  );
  if (await tareaCerrada(res, item.tarea_id)) return;
  await ejecutar(`DELETE FROM checklist_items WHERE id = ?`, [item.id]);
  res.json({ mensaje: "Elemento eliminado." });
});

/* ==============================================
 * FASE 7: COMENTARIOS
 * ============================================== */
app.post("/api/tareas/:id/comentarios", requiereSesion, conAcceso("tarea"), async (req, res) => {
  const textoComentario = texto(req.body.texto);
  if (!textoComentario) return fallo(res, 400, "El comentario no puede estar vacío.");
  if (textoComentario.length > 1000)
    return fallo(res, 400, "El comentario no puede superar 1000 caracteres.");
  await ejecutar(`INSERT INTO comentarios (texto, tarea_id, usuario_id) VALUES (?, ?, ?)`, [
    textoComentario,
    req.params.id,
    req.usuario.id,
  ]);
  res.status(201).json({ mensaje: "Comentario agregado." });
});

/* ==============================================
 * FASE 8: PANEL DE CONTROL (Dashboard)
 * ============================================== */
app.get("/api/dashboard", requiereSesion, async (req, res) => {
  const tareas = await tareasVisibles(req);
  tareas.forEach((t) => (t.vencida = esVencida(t)));

  const proyectos = await todos(
    `SELECT id, nombre FROM proyectos
     ${req.esAdmin ? "" : "WHERE id IN (SELECT proyecto_id FROM proyecto_miembros WHERE usuario_id = ?)"}
     ORDER BY nombre`,
    req.esAdmin ? [] : [req.usuario.id],
  );
  proyectos.forEach((p) => (p.resumen = resumir(tareas.filter((t) => t.proyecto_id === p.id))));

  const visibles = proyectos.map((p) => p.id);
  const actividad = visibles.length
    ? await todos(
        `SELECT b.accion, b.fecha, u.nombre AS usuario, t.id AS tarea_id, t.titulo,
                tb.id AS tablero_id, p.nombre AS proyecto
         FROM bitacora b
         JOIN tareas t ON b.tarea_id = t.id
         JOIN columnas c ON t.estado_id = c.id
         JOIN tableros tb ON c.tablero_id = tb.id
         JOIN proyectos p ON tb.proyecto_id = p.id
         LEFT JOIN usuarios u ON b.usuario_id = u.id
         WHERE p.id IN (${visibles.map(() => "?").join(",")})
         ORDER BY b.fecha DESC, b.id DESC LIMIT 12`,
        visibles,
      )
    : [];

  const abiertas = tareas.filter((t) => t.estado_tipo !== "completado");
  const porFecha = (a, b) => (a.fecha_limite || "9999").localeCompare(b.fecha_limite || "9999");
  res.json({
    resumen: resumir(tareas),
    proyectos,
    vencidas: tareas.filter((t) => t.vencida).sort(porFecha).slice(0, 10),
    mias: abiertas.filter((t) => t.responsable_id === req.usuario.id).sort(porFecha).slice(0, 10),
    actividad,
    tareas, // Datos planos para los reportes con filtros
  });
});

// Manejo central de errores inesperados (Express 5 captura los errores async)
app.use("/api", (req, res) => fallo(res, 404, "Ruta no encontrada."));
app.use((err, req, res, next) => {
  console.error("Error no controlado:", err);
  if (res.headersSent) return next(err);
  fallo(res, 500, "Error interno en el servidor.");
});

db.listo
  .then(() =>
    app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`)),
  )
  .catch((err) => {
    console.error("❌ No se pudo preparar la base de datos:", err);
    process.exit(1);
  });
