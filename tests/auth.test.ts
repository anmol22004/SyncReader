import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertInstantSignup, credentialError, submitAuth, type AuthApi } from '../src/lib/auth-actions';
const input = { email: ' reader@example.com ', password: '  strong password  ' };
test('V1 blocks signup while email confirmation is enabled or unknown', () => {
 assert.throws(() => assertInstantSignup({ mailer_autoconfirm: false }), /Turn off Confirm email/);
 assert.throws(() => assertInstantSignup({}), /Turn off Confirm email/);
 assert.doesNotThrow(() => assertInstantSignup({ mailer_autoconfirm: true }));
});
test('V1 handles disabled registration before creating an account', () => {
 assert.throws(() => assertInstantSignup({ mailer_autoconfirm: true, disable_signup: true }), /Enable new user signup/);
});
function mock() {
 const calls: { name: string; value: unknown }[] = [];
 const api: AuthApi = {
  async signInWithPassword(value) { calls.push({name:'signin',value}); return {error:null,data:{session:{}}}; },
  async signUp(value) { calls.push({name:'signup',value}); return {error:null,data:{session:{}}}; }
 }; return {api,calls};
}
test('V1 sign-in trims email and preserves password exactly', async()=>{
 const {api,calls}=mock(); await submitAuth(api,'signin',input); assert.deepEqual(calls,[{name:'signin',value:{email:'reader@example.com',password:input.password}}]);
});
test('V1 signup creates an immediate session without an email action or redirect', async()=>{
 const {api,calls}=mock(); await submitAuth(api,'signup',input); assert.deepEqual(calls,[{name:'signup',value:{email:'reader@example.com',password:input.password}}]);
});
test('V1 configuration mismatch does not pretend signup is completed',async()=>{
 const {api}=mock(); api.signUp=async()=>({error:null,data:{session:null}}); await assert.rejects(submitAuth(api,'signup',input),/Turn off Confirm email/);
});
test('V1 invalid credentials show an actionable error',async()=>{
 const {api}=mock(); api.signInWithPassword=async()=>({error:{code:'invalid_credentials',message:'internal'}}); await assert.rejects(submitAuth(api,'signin',input),/email or password is incorrect/);
});
test('V1 validates before sending credentials',async()=>{
 const {api,calls}=mock(); await assert.rejects(submitAuth(api,'signup',{...input,password:'short'}),/at least 8/); assert.equal(calls.length,0); assert.equal(credentialError('signin',input.email,'legacy'),null);
});
test('V1 duplicate account directs the user to sign in',async()=>{
 const {api}=mock(); api.signUp=async()=>({error:{code:'user_already_exists',message:'duplicate'}}); await assert.rejects(submitAuth(api,'signup',input),/Choose Sign in/);
});
test('V1 sign-in requires an actual session',async()=>{
 const {api}=mock(); api.signInWithPassword=async()=>({error:null,data:{session:null}}); await assert.rejects(submitAuth(api,'signin',input),/did not create a session/);
});
