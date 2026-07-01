// Top common passwords (abbreviated top-100 style list) to reject outright.
const COMMON_PASSWORDS = new Set([
  '123456', 'password', '123456789', '12345678', '12345', '1234567', '1234567890',
  'qwerty', 'abc123', 'password1', 'password123', '111111', '123123', '000000',
  'iloveyou', '1234', 'admin', 'welcome', 'monkey', 'login', 'princess', 'qwerty123',
  'solo', 'letmein', '654321', '666666', '121212', 'flower', 'passw0rd', 'dragon',
  'sunshine', 'master', 'hottie', 'loveme', 'zaq1zaq1', 'password!', 'qwertyuiop',
  'superman', 'football', 'baseball', 'welcome1', 'admin123', 'root', 'toor',
  'test', 'test123', 'guest', 'changeme', 'secret', 'ababab', 'trustno1',
  'whatever', 'starwars', 'shadow', 'michael', 'jennifer', 'jordan', 'harley',
  'ranger', 'buster', 'thomas', 'tigger', 'robert', 'soccer', 'batman', 'test1234',
  'pass123', 'hello123', 'freedom', 'ninja', 'azerty', 'access', 'mustang',
  'q1w2e3r4', '1q2w3e4r', 'zxcvbnm', 'asdfgh', 'aaaaaa', 'p@ssw0rd', 'p@ssword',
  'passw0rd!', 'welcome123', 'admin@123', 'summer', 'winter', 'autumn', 'spring',
  'computer', 'internet', 'samsung', 'google', 'facebook', 'apple', 'orange',
  'banana', 'cheese', 'chicken', 'monkey123', 'iloveyou1', 'abcd1234', 'a1b2c3d4',
]);

// Individual requirement checks (also used to drive the frontend meter concept).
const requirements = {
  length: (pw) => pw.length >= 12,
  uppercase: (pw) => /[A-Z]/.test(pw),
  lowercase: (pw) => /[a-z]/.test(pw),
  number: (pw) => /[0-9]/.test(pw),
  special: (pw) => /[!@#$%^&*]/.test(pw),
};

// Validate a password against the policy. Returns { valid, errors[] }.
function validatePassword(password, { name = '', email = '' } = {}) {
  const errors = [];
  const pw = password || '';

  if (!requirements.length(pw)) errors.push('Password must be at least 12 characters');
  if (!requirements.uppercase(pw)) errors.push('Password must contain an uppercase letter');
  if (!requirements.lowercase(pw)) errors.push('Password must contain a lowercase letter');
  if (!requirements.number(pw)) errors.push('Password must contain a number');
  if (!requirements.special(pw)) errors.push('Password must contain a special character (!@#$%^&*)');

  const lower = pw.toLowerCase();
  if (name && lower.includes(name.toLowerCase().trim()) && name.trim().length >= 3) {
    errors.push('Password cannot contain your name');
  }
  if (email) {
    const local = email.split('@')[0].toLowerCase();
    if (local.length >= 3 && lower.includes(local)) {
      errors.push('Password cannot contain your email');
    }
  }
  if (COMMON_PASSWORDS.has(lower)) {
    errors.push('Password is too common');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validatePassword, COMMON_PASSWORDS, requirements };
