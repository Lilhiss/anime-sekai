export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, username, resetLink } = req.body;

  // Basic validation
  if (!to || !username || !resetLink) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Make sure the reset link points to your own domain (prevents abuse)
  if (!resetLink.startsWith('https://anime-sekai-quiz.vercel.app')) {
    return res.status(400).json({ error: 'Invalid reset link domain.' });
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: '"Anime Sekai Quiz" <onboarding@resend.dev>',
        to: [to],
        subject: 'Reset your Anime Sekai password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
            <h2 style="font-size:22px;margin-bottom:8px">Reset your password</h2>
            <p style="color:#666;margin-bottom:24px">Hi <strong>${username}</strong>, we received a request to reset your Anime Sekai Quiz password. Click the button below — the link expires in 1 hour.</p>
            <a href="${resetLink}" style="display:inline-block;background:#a78bfa;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px">Reset Password</a>
            <p style="color:#999;font-size:12px;margin-top:28px">If you didn't request this, you can safely ignore this email. The link expires in 1 hour.</p>
          </div>`,
        text: `Hi ${username},\n\nReset your Anime Sekai Quiz password here:\n${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`
      })
    });

    if (!emailRes.ok) {
      const err = await emailRes.json();
      return res.status(500).json({ error: err?.message || 'Email delivery failed.' });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
}
