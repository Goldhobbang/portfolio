import { CONFIG } from './config.js';
import * as T from '../../vendor/three-r180/three.module.js';

// C-start: unilateral bend, counterstroke / burst, then coast and recover.
// Timing is stretched slightly so the response reads at interactive frame rates.
export function createEscape(root, bones) {
  const offset = new T.Vector3();
  const direction = new T.Vector3();
  const heading = new T.Vector3();
  const projected = new T.Vector3();
  const view = new T.Vector3();
  const viewForward = new T.Vector3();
  const bendAxis = new T.Vector3(0, 0, 1); // rig bones use local Z for lateral flexion
  const bendQuat = new T.Quaternion();
  const joints = ['Spine_01', 'Spine_02', 'CaudalPeduncle', 'CaudalBase', 'CaudalFin_01']
    .map(name => bones[name]).filter(Boolean)
    .map(bone => ({ bone, pose: new T.Quaternion() }));
  let age = 10, strength = 0, side = 1, applied = false;

  function start(ndc, camera, radius) {
    view.copy(root.position).applyMatrix4(camera.matrixWorldInverse);
    projected.copy(root.position).project(camera);
    if (view.z >= -0.1 || Math.abs(projected.z) > 1) return false;
    const dx = (projected.x - ndc.x) * innerWidth / 2;
    const dy = (projected.y - ndc.y) * innerHeight / 2;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) return false;
    strength = 0.65 + 0.35 * (1 - distance / radius);
    // A separate threat point at each fish's depth avoids pulling distant fish
    // toward one arbitrary world-space click plane.
    const threat = new T.Vector3(ndc.x, ndc.y, projected.z).unproject(camera);
    direction.copy(root.position).sub(threat);
    if (direction.lengthSq() < 0.001) direction.set(Math.random() - 0.5, 0.2, 0);
    camera.getWorldDirection(viewForward);
    direction.addScaledVector(viewForward, 0.5 + Math.random() * 0.5);
    direction.normalize();
    heading.set(0, 0, 1).applyQuaternion(root.quaternion);
    side = Math.sign(heading.z * direction.x - heading.x * direction.z) || 1;
    age = -0.015 - Math.random() * 0.04;
    return true;
  }

  function update(dt, target) {
    age += dt;
    const burst = age > 0.11 ? Math.exp(-(age - 0.11) * CONFIG.motion.anglerEscapeDecay) : 0;
    if (age >= 0 && age < 2.8) {
      // Rotate the body first; thrust follows its heading, avoiding sideways slides.
      const turn = 1 - Math.exp(-dt * (age < 0.16 ? 22 : 10));
      heading.lerp(direction, turn).normalize();
      offset.addScaledVector(heading, dt * burst * CONFIG.motion.anglerEscapeSpeed * strength);
    } else if (age >= 2.8) {
      offset.multiplyScalar(Math.exp(-dt * 0.22));
    }
    root.position.add(offset);
    target.add(offset);
    const response = age >= 0 && age < 2.8 ? Math.exp(-Math.max(0, age - 0.5) * 2) : 0;
    if (response > 0) target.lerp(view.copy(root.position).add(heading), response);
    return response;
  }

  function restorePose() {
    if (applied) joints.forEach(({ bone, pose }) => bone.quaternion.copy(pose));
    applied = false;
  }

  function applyPose() {
    if (age < 0 || age > 2.8) return;
    const curl = age < 0.11 ? Math.sin(age / 0.11 * Math.PI) * side * 0.55 : 0;
    const stroke = age >= 0.11 ? Math.sin((age - 0.11) * 24) * Math.exp(-(age - 0.11) * 2.2) * 0.27 : 0;
    joints.forEach(({ bone, pose }, i) => {
      pose.copy(bone.quaternion);
      bendQuat.setFromAxisAngle(bendAxis, (curl + stroke * Math.cos(i * 0.65 - age * 4)) * strength);
      bone.quaternion.multiply(bendQuat);
    });
    applied = true;
  }

  return { start, update, restorePose, applyPose, get active() { return age < 2.8; } };
}
