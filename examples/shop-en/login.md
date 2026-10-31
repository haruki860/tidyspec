# Login

## Spec

- Sign in with an email address and a password
- After 5 wrong attempts in a row, sign-in is locked for 15 minutes
- A forgotten password is reset by an emailed link

## Design

- The lock is per account, never per IP address
- Locking does not send the owner an email
- The failure count goes back to 0 after a successful sign-in

## Code

- Lock decision: src/auth/lock.ts
- Sign-in handling: src/auth/login.ts
- Screen: src/pages/login.tsx

## Data

- users
- sessions
