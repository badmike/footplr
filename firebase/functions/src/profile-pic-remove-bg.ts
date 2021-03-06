import { Storage } from "@google-cloud/storage";
import * as firebase from "firebase-admin";
import * as functions from "firebase-functions";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { removeBackgroundFromImageFile } from "remove.bg";
import { apiKey } from "./remove-bg-apikey.json";

let _initDone = false;

/** Respond to the successful creation of an object in Storage. */
export const removeBg = functions.storage.object().onFinalize(async (object) => {
  const fileBucket = object.bucket;
  const filePath = object.name;

  // this only concerns profile pictures
  if (!filePath.startsWith("profilepics/")) {
    return;
  }

  const fileName = path.basename(filePath);

  // the app saves the file as '<user.id>.jpg', and this script saves it as '<user.id>.png', so if it's a png: skip!
  const indexOfJpgExt = fileName.lastIndexOf(".jpg");
  if (indexOfJpgExt === -1) {
    return null;
  }

  const userId = fileName.substring(0, indexOfJpgExt);

  const bucket = new Storage({
    projectId: "foorball-player-ratings"
  }).bucket(fileBucket);

  const outputFile = path.join(os.tmpdir(), fileName);

  await bucket.file(filePath).download({
    destination: outputFile
  });

  try {
    await removeBackgroundFromImageFile({
      path: outputFile,
      size: "regular",
      apiKey,
      outputFile
    });

    // removing the background worked, and it's now a .png file
    const newFile = filePath.replace(".jpg", ".png");
    await bucket.upload(outputFile, {
      destination: newFile,
      contentType: "image/png",
      predefinedAcl: "publicRead"
    });

    if (!_initDone) {
      firebase.initializeApp();
      _initDone = true;
    }

    // now that we've updated the image (and its name), update the related user as well
    firebase.firestore().settings({ timestampsInSnapshots: true });
    const userRef = await firebase.firestore().doc(`users/${userId}`);

    const bucketName = "foorball-player-ratings.appspot.com";
    await userRef.update({
      picture: `https://storage.googleapis.com/${bucketName}/${newFile}?updateTs=${new Date().getTime()}`,
      lastupdate: firebase.firestore.FieldValue.serverTimestamp() // this makes sure the player is updated, so listeners (in the app) get updated
    });

    // delete the old file from storage
    const file = bucket.file(filePath);
    await file.delete();

  } catch (e) {
    console.log("Error caught: " + e);
    return null;
  }

  fs.unlinkSync(outputFile);

  return null;
});
