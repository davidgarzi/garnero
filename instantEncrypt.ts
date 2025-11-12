// Import bcryptjs
import _bcrypt from "bcryptjs"; 

// The string you want to hash
const password = "password";

// Hash the password
const hashedPassword = _bcrypt.hashSync(password, 10);

// Print the hashed password
console.log(`Hashed password: ${hashedPassword}`);
