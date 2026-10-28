# Gestor de Proyectos y Tareas (QA)

Proyecto final del curso **Aseguramiento de la Calidad del Software**, Universidad Mariano Gálvez de Guatemala.

Es una aplicación web para gestionar proyectos con tableros Kanban, al estilo de Trello o ClickUp. El servidor controla las transiciones de estado de las tareas y guarda una bitácora de cada cambio.

## Funcionalidades

- **Autenticación**: registro, inicio de sesión y recuperación de contraseña por correo.
- **Roles**:
  - **Administrador**: gestiona usuarios, proyectos, tableros, columnas y miembros.
  - **Miembro/Colaborador**: trabaja solo en los proyectos a los que fue asignado.
- **Jerarquía**: Proyecto → Tablero → Columna → Tarea → Subtarea → Checklist.
- **Tareas**:
  - Datos: tipo (Tarea o Bug), prioridad, etiquetas, responsable, fecha límite.
  - Las tareas vencidas se resaltan.
- **Drag and drop** entre columnas, validado por el servidor.
- **Transiciones de estado controladas** (ver más abajo).
- **Trazabilidad**: bitácora de cambios por tarea y comentarios.
- **Inicio (dashboard)**:
  - Indicadores y resumen por proyecto.
  - Gráfica de tareas por estado con filtros.
  - Listas de tareas asignadas, vencidas y actividad reciente.

## Tecnologías

| Capa | Herramientas |
|------|--------------|
| Servidor | Node.js 18+, Express 5, express-session, bcryptjs |
| Base de datos | SQLite (`sqlite3`) |
| Correo | Nodemailer (Ethereal en modo prueba, BillionMail en producción) |
| Interfaz | HTML, Bootstrap 5.3, SortableJS, Chart.js (por CDN) |

## Instalación y ejecución

```bash
npm install
npm start        # o: npm run dev  (reinicia al guardar cambios)
```

Abre <http://localhost:3000>.

La base de datos `data/sistema.db` se crea sola la primera vez. Las migraciones se aplican automáticamente al iniciar el servidor.

### Primer uso

1. En la pantalla de inicio elige **Crear cuenta**.
2. Selecciona el rol **Administrador** e ingresa el código `ADMIN123`.
3. Desde **Proyectos**, crea un proyecto. Se le crea un tablero con las cuatro columnas base.
4. Registra otros usuarios como Miembro/Colaborador y agrégalos al proyecto desde **Gestionar miembros**.

Las contraseñas deben tener al menos 8 caracteres, una mayúscula y un número.

## Configuración (`.env`)

El archivo `.env` es **opcional**. Sin él, la app usa los valores por defecto y envía los correos en modo prueba.

Para cambiar algo, copia `.env.example` como `.env`:

| Variable | Por defecto | Uso |
|----------|-------------|-----|
| `PORT` | `3000` | Puerto del servidor |
| `APP_URL` | `http://localhost:PORT` | Base del enlace del correo de recuperación |
| `SESSION_SECRET` | valor fijo de desarrollo | Firma de la cookie de sesión |
| `CODIGO_ADMIN` | `ADMIN123` | Código para registrarse como Administrador |
| `SMTP_HOST` | vacío | Servidor SMTP real. Si está vacío se usa el modo prueba |
| `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | — | Credenciales del buzón SMTP |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `true` | Pon `false` si el certificado es autofirmado |

### Recuperación de contraseña

- **Modo prueba (sin `SMTP_HOST`)**:
  - El correo se envía a una cuenta temporal de [Ethereal](https://ethereal.email).
  - En pantalla aparece el enlace **Ver correo de prueba**, que muestra el mensaje con el enlace para restablecer.
  - No necesita dominio ni configuración.
- **Correo real**: configura las variables `SMTP_*` con un buzón de [BillionMail](https://github.com/aaPanel/BillionMail) u otro servidor SMTP. BillionMail necesita un dominio propio con DNS.

El enlace vence en 1 hora y solo se puede usar una vez. La respuesta es la misma exista o no el correo, para no revelar qué cuentas están registradas.

## Reglas de transición de estado

El estado de una tarea depende del **tipo** de su columna, no del nombre. Así, una columna se puede renombrar sin romper las reglas.

| Desde | Hacia | Condición |
|-------|-------|-----------|
| Por hacer | En progreso | La tarea debe tener responsable |
| En progreso | En revisión / QA | Solo el responsable o un Administrador. Debe tener al menos una subtarea y todas completadas |
| En revisión / QA | Completado | — |
| En revisión / QA | En progreso | Se debe describir el defecto. Queda registrado como comentario |
| Completado | En progreso | Solo un Administrador, indicando el motivo |

Cualquier otro salto (por ejemplo, de Por hacer a Completado) se rechaza y la tarjeta regresa a su columna.

Las fechas se registran solas:

- **Inicio**: al pasar a En progreso.
- **Cierre**: al completar. Se borra si la tarea se reabre.

## Estructura del proyecto

```
├── data/                 Base de datos SQLite (no se sube a git)
├── public/               Interfaz (archivos estáticos)
│   ├── css/app.css       Estilos de toda la app
│   ├── js/layout.js      Barra superior, menú lateral y utilidades (App)
│   ├── js/*.js           Lógica de cada página
│   ├── index.html        Inicio de sesión, registro y recuperación
│   ├── restablecer.html  Nueva contraseña desde el enlace del correo
│   ├── dashboard.html    Inicio con indicadores y reportes
│   ├── proyectos.html    Proyectos (vista de tarjetas o tabla)
│   ├── tablero.html      Tablero Kanban y detalle de tareas
│   └── usuarios.html     Administración de usuarios (solo Administrador)
├── src/
│   ├── server.js         API REST, permisos y reglas de negocio
│   ├── database.js       Tablas y migraciones (PRAGMA user_version)
│   └── mailer.js         Envío del correo de recuperación
└── .env.example          Plantilla de configuración
```

## API

Todas las rutas están bajo `/api`. Salvo las de autenticación, todas requieren sesión. El servidor valida en cada una el rol y que el usuario sea miembro del proyecto.

| Recurso | Rutas |
|---------|-------|
| Autenticación | `POST /registro`, `POST /login`, `GET /sesion`, `POST /logout`, `POST /recuperar`, `POST /restablecer` |
| Usuarios | `GET/POST /usuarios`, `PUT /usuarios/:id` |
| Proyectos | `GET/POST /proyectos`, `PUT/DELETE /proyectos/:id`, `GET/PUT /proyectos/:id/miembros`, `POST /proyectos/:id/tableros` |
| Tableros | `GET/PUT/DELETE /tableros/:id`, `POST /tableros/:id/columnas`, `POST /tableros/:id/tareas` |
| Columnas | `PUT/DELETE /columnas/:id` |
| Tareas | `GET/PUT/DELETE /tareas/:id`, `PUT /tareas/:id/estado`, `POST /tareas/:id/subtareas`, `POST /tareas/:id/comentarios` |
| Subtareas y checklist | `PUT/DELETE /subtareas/:id`, `POST /subtareas/:id/items`, `PUT/DELETE /items/:id` |
| Inicio | `GET /dashboard` |

## Pruebas

Pendiente: plan de pruebas, casos de prueba y registro de bugs encontrados.
