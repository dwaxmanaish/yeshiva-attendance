import 'dotenv/config';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';

const client = new Mailgun(FormData).client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY,
  url: process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net'
});

export async function sendClassEmail({ to, className, teacherName, studentName }) {
  if (!process.env.MAILGUN_DOMAIN) throw new Error('MAILGUN_DOMAIN is not set');
  if (!process.env.MAILGUN_API_KEY) throw new Error('MAILGUN_API_KEY is not set');
  const fromAddress = `no-reply@${process.env.MAILGUN_DOMAIN}`;
  const from = process.env.MAILGUN_FROM || `Aish Attendance <${fromAddress}>`;

  const text = `${teacherName} has requested that ${studentName} be added to the following class: ${className}`;

  return client.messages.create(process.env.MAILGUN_DOMAIN, {
    from,
    to,
    subject: `Class Add Request: ${className}`,
    text
  });
}


