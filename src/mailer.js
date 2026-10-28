/* ============================================================================
 * ARCHIVO: mailer.js
 * DESCRIPCIÓN: Envío de correos a través del servidor BillionMail (SMTP).
 *
 * BillionMail (github.com/aaPanel/BillionMail) usa Postfix/Dovecot, por lo que
 * la aplicación se conecta por SMTP autenticado con un buzón creado en su panel
 * (por ejemplo no-reply@tudominio.com). La configuración se lee del archivo .env.
 *
 * MODO PRUEBA (sin .env): si no hay SMTP_HOST configurado se usa Ethereal
 * (ethereal.email), un buzón falso de nodemailer. No requiere dominio ni
 * registro: los correos NO llegan al destinatario real, pero se pueden ver en
 * el navegador con la URL de vista previa que se imprime en consola.
 * ============================================================================ */
const nodemailer = require("nodemailer");

const modoPrueba = !process.env.SMTP_HOST;
let transporte = null;

async function obtenerTransporte() {
  if (transporte) return transporte;

  if (modoPrueba) {
    // Crea una cuenta temporal en Ethereal (una sola vez por ejecución)
    const cuenta = await nodemailer.createTestAccount();
    transporte = nodemailer.createTransport({
      host: cuenta.smtp.host,
      port: cuenta.smtp.port,
      secure: cuenta.smtp.secure,
      auth: { user: cuenta.user, pass: cuenta.pass },
    });
    console.log("📧 Modo prueba: correos enviados a Ethereal (no se entregan de verdad).");
    return transporte;
  }

  const puerto = Number(process.env.SMTP_PORT) || 587;
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: puerto,
    secure: puerto === 465, // 465 = SSL directo; 587 = STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Permite certificados autofirmados (común en BillionMail recién instalado)
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false" },
  });
  return transporte;
}

// Devuelve la URL de vista previa del correo (solo en modo prueba), o null
async function enviarCorreoRecuperacion(destinatario, nombre, enlace) {
  const t = await obtenerTransporte();
  const info = await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "QA Proyectos <no-reply@qa-proyectos.local>",
    to: destinatario,
    subject: "Recuperación de contraseña - QA Proyectos",
    text:
      `Hola ${nombre},\n\n` +
      `Recibimos una solicitud para restablecer tu contraseña.\n` +
      `Abre este enlace para crear una nueva (válido por 1 hora):\n\n${enlace}\n\n` +
      `Si no solicitaste este cambio, ignora este mensaje.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#0d6efd">Recuperación de contraseña</h2>
        <p>Hola <strong>${escaparHtml(nombre)}</strong>,</p>
        <p>Recibimos una solicitud para restablecer tu contraseña.
           Haz clic en el botón para crear una nueva. El enlace es válido por <strong>1 hora</strong>.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${enlace}" style="background:#0d6efd;color:#fff;padding:12px 24px;
             border-radius:6px;text-decoration:none;font-weight:bold">Restablecer contraseña</a>
        </p>
        <p style="font-size:12px;color:#6c757d">Si el botón no funciona copia este enlace:<br>${enlace}</p>
        <p style="font-size:12px;color:#6c757d">Si no solicitaste este cambio, ignora este mensaje.</p>
      </div>`,
  });

  if (!modoPrueba) return null;
  const vistaPrevia = nodemailer.getTestMessageUrl(info);
  console.log(`📨 Correo de recuperación para ${destinatario}`);
  console.log(`   Ver correo:  ${vistaPrevia}`);
  console.log(`   Enlace:      ${enlace}`);
  return vistaPrevia;
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

module.exports = { enviarCorreoRecuperacion };
