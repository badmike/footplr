import * as firebase from "firebase-admin";
import * as functions from "firebase-functions";
import { Excercises, Exercise } from "./shared/exercises";
import { Measurement } from "./shared/measurement";
import Scores from "./shared/scores";
import { LatestMeasurements, LatestMeasurementsWrapper, ScoresWrapper, SharedUser } from "./shared/shared-user";

// perhaps it's more efficient to store measurements in the root.. that's probably easier to watch for Firebase: measurements/{measurementId}
exports.onMeasurementWrite = functions.firestore.document("users/{userId}/measurements/{measurementId}").onWrite(async (snap, context) => {
  let measurement: firebase.firestore.DocumentSnapshot;
  let isDeleted = false;
  let allDeleted = false;

  if (!snap.after.exists) {
    isDeleted = true;
    const removedMeasurement: firebase.firestore.DocumentSnapshot = snap.before;
    const exercise = (<Measurement>removedMeasurement.data()).exercise;
    const allMeasurementsRef: firebase.firestore.Query = snap.before.ref.parent;
    const querySnapshot = await allMeasurementsRef.where("exercise", "==", exercise).get();
    querySnapshot.forEach(doc => {
      const olderMeasurement = <Measurement>doc.data();
      if (!measurement || (<any>measurement.data().date).toDate().getTime() < (<any>olderMeasurement.date).toDate().getTime()) {
        measurement = doc;
      }
    });

    if (!measurement) {
      allDeleted = true;
      measurement = removedMeasurement;
      // there was no older measurement, so all measurements of this exercise have been deleted
    }

  } else {
    measurement = snap.after;
  }

  const measurementData = <Measurement>measurement.data();

  // find our user
  const userRef: firebase.firestore.DocumentReference = snap.after.ref.parent.parent;
  const user = <SharedUser>(await userRef.get()).data();

  // make sure the data we want to update exists
  if (!user.latestmeasurements) {
    user.latestmeasurements = <LatestMeasurementsWrapper>{
      official: {},
      unofficial: {}
    };
  }

  if (!user.scores) {
    user.scores = <ScoresWrapper>{
      combined: {},
      official: {},
      unofficial: {}
    };
  }

  // find the latest measurement of this exercise
  const latestMeasurements = measurementData.official ? user.latestmeasurements.official : user.latestmeasurements.unofficial;

  // only update if this one is newer than what we have (hardening against edits/migration)
  if (isDeleted || !latestMeasurements[measurementData.exercise] || (<any>latestMeasurements[measurementData.exercise].date).toDate().getTime() <= (<any>measurementData.date).toDate().getTime()) {
    if (allDeleted) {
      delete latestMeasurements[measurementData.exercise];
    } else {
      latestMeasurements[measurementData.exercise] = measurementData;
    }

    // now update the scores, based on latestMeasurements
    if (measurementData.official) {
      user.scores.official = calculateScores(latestMeasurements);
    } else {
      user.scores.unofficial = calculateScores(latestMeasurements);
    }
    user.scores.combined = calculateScores(getLatestMeasurementsCombined(user.latestmeasurements));

    await userRef.update({
      latestmeasurements: user.latestmeasurements,
      scores: user.scores,
      lastupdate: firebase.firestore.FieldValue.serverTimestamp() // this makes sure the player is updated, so listeners (in the app) get updated
    });
  }

  return null;
});

function getLatestMeasurementsCombined(measurements: LatestMeasurementsWrapper): LatestMeasurements {
  const result = <LatestMeasurements>{};

  for (const k in measurements.official) {
    result[k] = measurements.official[k];
  }

  for (const k in measurements.unofficial) {
    const val = measurements.unofficial[k];
    if (!result[k] || result[k].date.toDate().getTime() < val.date.toDate().getTime()) {
      result[k] = val;
    }
  }
  return result;
}

function calculateScores(measurements: LatestMeasurements): Scores {
  const PAC = Math.round(
      (calculateScore(measurements.STAMINA, Excercises.STAMINA) +
          calculateScore(measurements.DRIBBLE, Excercises.DRIBBLE) +
          calculateScore(measurements.SPEED_OF_ACTION, Excercises.SPEED_OF_ACTION) +
          calculateScore(measurements.EXPLOSIVENESS, Excercises.EXPLOSIVENESS) +
          calculateScore(measurements.SPRINT, Excercises.SPRINT) +
          calculateScore(measurements.HEARTRATE, Excercises.HEARTRATE) +
          calculateScore(measurements.AGILITY, Excercises.AGILITY)) / 7);

  const TEC = Math.round(
      (calculateScore(measurements.SPEED_OF_ACTION, Excercises.SPEED_OF_ACTION) +
          calculateScore(measurements.PASSING_MOVEMENTS, Excercises.PASSING_MOVEMENTS) +
          calculateScore(measurements.AIM, Excercises.AIM) +
          calculateScore(measurements.CONTROL_LOW_BALL, Excercises.CONTROL_LOW_BALL) +
          calculateScore(measurements.CONTROL_HIGH_BALL, Excercises.CONTROL_HIGH_BALL)) / 5);

  const DRI = Math.round(
      calculateScore(measurements.DRIBBLE, Excercises.DRIBBLE));

  const PAS = Math.round(
      (calculateScore(measurements.AGILITY, Excercises.AGILITY) +
          calculateScore(measurements.AIM, Excercises.AIM) +
          calculateScore(measurements.CROSSPASS, Excercises.CROSSPASS)) / 3);

  const PHY = Math.round(
      (calculateScore(measurements.STAMINA, Excercises.STAMINA) +
          calculateScore(measurements.EXPLOSIVENESS, Excercises.EXPLOSIVENESS) +
          calculateScore(measurements.SPRINT, Excercises.SPRINT) +
          calculateScore(measurements.HEARTRATE, Excercises.HEARTRATE) +
          calculateScore(measurements.HEADER_HEIGHT, Excercises.HEADER_HEIGHT) +
          calculateScore(measurements.JUMP_HEIGHT, Excercises.JUMP_HEIGHT) +
          calculateScore(measurements.SIT_UPS, Excercises.SIT_UPS) +
          calculateScore(measurements.PUSH_UPS, Excercises.PUSH_UPS)) / 8);

  const SHO = Math.round(
      (calculateScore(measurements.SHOT_STRENGTH, Excercises.SHOT_STRENGTH) +
          calculateScore(measurements.AIM, Excercises.AIM)) / 2);

  const TOTAL = Math.round((PAC + TEC + DRI + PAS + PHY + SHO) / 6);

  return <Scores>{
    PAC,
    TEC,
    DRI,
    PAS,
    PHY,
    SHO,
    TOTAL
  };
}

function calculateScore(measurement: Measurement, exercise: Exercise): number {
  return measurement ? exercise.calculateScore(measurement.measurement) : 0;
}