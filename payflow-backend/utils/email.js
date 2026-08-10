const nodemailer = require("nodemailer");

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT == 465, // true for port 465, false for 587/others
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendResetPasswordEmail(to, resetLink) {
  const transporter = getTransporter();

  await transporter.sendMail({
    from: `"PayFlow" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject: "Reset your PayFlow password",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
        <h2 style="color:#0a2540;">Reset your password</h2>
        <p>We received a request to reset your PayFlow password. This link expires in 30 minutes.</p>
        <p>
          <a href="${resetLink}" style="background:#0d6efd;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">
            Reset password
          </a>
        </p>
        <p style="color:#888;font-size:13px;">
          If you didn't request this, you can safely ignore this email — your password will not be changed.
        </p>
      </div>
    `,
  });
}

module.exports = { sendResetPasswordEmail };
