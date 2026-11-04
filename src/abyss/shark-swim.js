import { CONFIG } from './config.js';
import * as T from '../../vendor/three-r180/three.module.js';

const TAU = Math.PI * 2;
const clamp = T.MathUtils.clamp;

// Drive the existing skinned rig, never the mesh vertices or its proportions.
// Angles describe absolute body tangents; parent tangents are subtracted so
// bends do not accumulate into an exaggerated eel-like curl.
export function createSharkSwimmer(root, bones, { phase = 0, large = false } = {}) {
  root.updateMatrixWorld(true);
  const rootInverse = root.getWorldQuaternion(new T.Quaternion()).invert();
  const joints = {};
  for (const [name, bone] of Object.entries(bones)) {
    const modelInverse = rootInverse.clone().multiply(bone.getWorldQuaternion(new T.Quaternion())).invert();
    joints[name] = {
      bone, rest: bone.quaternion.clone(),
      // glTF bone axes differ at the peduncle and the two caudal lobes.
      // Transform model-space axes into each joint's actual bind frame.
      yawAxis: new T.Vector3(0, 1, 0).applyQuaternion(modelInverse),
      pitchAxis: new T.Vector3(1, 0, 0).applyQuaternion(modelInverse),
      rollAxis: new T.Vector3(0, 0, 1).applyQuaternion(modelInverse)
    };
  }
  const q = new T.Quaternion();
  let beatPhase = phase;
  let frequency = (large ? 0.38 : 0.48) * CONFIG.swim.frequencyMultiplier;
  let amplitude = 0.7 * CONFIG.swim.amplitudeMultiplier;
  let turn = 0, climb = 0, glide = 0;
  const stats = { frequency, amplitude, glide, headYaw: 0, tailYaw: 0 };

  function rotate(name, angle, parentAngle = 0, pitch = 0, roll = 0) {
    const j = joints[name];
    if (!j) return;
    j.bone.quaternion.copy(j.rest);
    q.setFromAxisAngle(j.yawAxis, angle - parentAngle);
    j.bone.quaternion.multiply(q);
    if (pitch) j.bone.quaternion.multiply(q.setFromAxisAngle(j.pitchAxis, pitch));
    if (roll) j.bone.quaternion.multiply(q.setFromAxisAngle(j.rollAxis, roll));
  }

  function update(dt, { speed = 0.2, turnRate = 0, pitch = 0, glideAmount = 0, escape = 0, bend = 0 } = {}) {
    if (dt <= 0) return stats;
    // Speed is in body lengths per second, independent of instance scale.
    const effort = clamp(speed / 0.7, 0, 1);
    const smooth = 1 - Math.exp(-dt * 5);
    glide += ((escape > 0.05 ? 0 : glideAmount) - glide) * smooth;
    turn += (clamp(turnRate, -1.2, 1.2) - turn) * smooth;
    climb += (clamp(pitch, -CONFIG.motion.sharkPitchLimit, CONFIG.motion.sharkPitchLimit) - climb) * smooth;
    const targetFrequency = ((large ? 0.32 : 0.40) + effort * 0.62 + escape * 0.85) * CONFIG.swim.frequencyMultiplier;
    // Analytic integration of the filtered frequency keeps phase continuous
    // when speed changes and agrees at different rendering frame rates.
    const decay = Math.exp(-dt * 4);
    beatPhase = (beatPhase + TAU * (targetFrequency * dt + (frequency - targetFrequency) * (1 - decay) / 4)) % TAU;
    frequency = targetFrequency + (frequency - targetFrequency) * decay;
    const targetAmplitude = (0.55 + effort * 0.5 + escape * 0.30) * (1 - glide * CONFIG.swim.glideReduction) * CONFIG.swim.amplitudeMultiplier;
    amplitude += (targetAmplitude - amplitude) * smooth;

    const wave = (s, a) => amplitude * a * Math.sin(beatPhase - s * 3.6);
    const steer = clamp(-turn * 0.13, -0.14, 0.14);
    const front = wave(0, 0.006);
    const head = wave(-0.08, 0.003);
    const snout = wave(-0.16, 0.0015);
    const spine1 = wave(0.38, 0.045) + steer * 0.25 + bend * 0.15;
    const spine2 = wave(0.60, 0.14) + steer * 0.65 + bend * 0.55;
    const peduncle = wave(0.79, 0.28) + steer + bend;
    const tail = wave(0.94, 0.43) + steer + bend * 0.8;
    const tip = tail + wave(1.02, 0.025);

    rotate('Root', front);
    rotate('Head', head, front);
    rotate('Snout', snout, head);
    rotate('Spine_01', spine1, front);
    rotate('Spine_02', spine2, spine1);
    rotate('CaudalPeduncle', peduncle, spine2);
    rotate('CaudalBase', tail, peduncle);
    // Both lobes follow one caudal fin rather than flapping independently.
    rotate('CaudalUpper', tip, tail);
    rotate('CaudalLower', tip, peduncle);
    rotate('DorsalFin', front, front);
    // Extended pectorals: a few degrees of trim, with no periodic flapping.
    const trim = clamp(climb * 0.18, -0.045, 0.045);
    const finTurn = clamp(turn * 0.065, -0.065, 0.065);
    rotate('Pectoral_L', front, front, trim + finTurn, -finTurn * 0.35);
    rotate('Pectoral_R', front, front, trim - finTurn, -finTurn * 0.35);

    Object.assign(stats, { frequency, amplitude, glide, headYaw: head, tailYaw: tail });
    return stats;
  }

  return { update, stats };
}
