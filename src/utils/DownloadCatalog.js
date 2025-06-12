import manifest from "./2025-05-21.0.json";
import init, { // <-- Ajoutez 'init' ici
  ParquetDataset,
  set_panic_hook,
  writeGeoJSON,
} from "@geoarrow/geoarrow-wasm/esm/index.js";

const awsbasepath = "https://overturemaps-us-west-2.s3.amazonaws.com/release/";

/**
 *
 * @param {*} bbox
 * @param {*} visibleTypes an array of type names that are currently visible on the map
 * @returns an object with the 'basepath' and array of filespecs 'files' */
export function getDownloadCatalog(bbox, visibleTypes) {
  let fileCatalog = {};
  let types = [];

  const versionPath = awsbasepath + manifest.release_version;

  fileCatalog.basePath = versionPath;
  manifest.themes.forEach((theme) => {
    // If the theme isn't visible, don't download it.
    theme.types.forEach((type) => {
      if (!visibleTypes.includes(type.name)) {
        return;
      }
      let typeEntry = {};
      typeEntry.files = [];

      type.files.forEach((file) => {
        typeEntry.name = type.name;

        let newName = `${theme.relative_path}${type.relative_path}/${file.name}`;
        if (intersects(bbox, file.bbox)) {
          typeEntry.files.push(newName);
        }
      });
      if (typeEntry.files.length > 0) {
        types.push(typeEntry);
      }
    });
  });

  fileCatalog.types = types;
  return fileCatalog;
}

// Calculate intersection given 4-item bbox list of [minx, miny, maxx, maxy]
function intersects(bb1, bb2) {
  return (
    bb1[0] < bb2[2] && bb1[2] > bb2[0] && bb1[1] < bb2[3] && bb1[3] > bb2[1]
  );
}

export const handleDownloadClick = async (bbox, setGeoJsonData) => {
  // --- NOUVEAU : Initialiser le module WASM en premier ---
  try {
    await init(); // Appel et attente de la fonction d'initialisation
    set_panic_hook(); // Maintenant, set_panic_hook devrait être défini
  } catch (error) {
    console.error("Erreur lors de l'initialisation de GeoArrow WASM:", error);
    alert("Impossible de charger les composants de carte. Veuillez réessayer.");
    return; // Arrêter l'exécution si l'initialisation échoue
  }
  // --- FIN DE L'INITIALISATION ---

  const xmin = ["bbox", "xmin"];
  const ymin = ["bbox", "ymin"];
  const xmax = ["bbox", "xmax"];
  const ymax = ["bbox", "ymax"];

  const readOptions = {
    bbox: bbox,
    bboxPaths: {
      xmin,
      ymin,
      xmax,
      ymax,
    },
  };
  let downloadCatalog = getDownloadCatalog(bbox, ["water"]);

  // The catalog contains a base path and then a list of types with filenames.
  //First, assemble the parquet datasets in parallel.
  let datasets = downloadCatalog.types.map((type) => {
    return new ParquetDataset(downloadCatalog.basePath, type.files).then(
      (dataset) => {
        return { type: type.name, parquet: dataset };
      }
    );
  });

  Promise.all(datasets)
    .then((datasets) => {
      return datasets.map((dataset) =>
        dataset.parquet.read(readOptions).then((reader) => {
          return { type: dataset.type, reader: reader };
        })
      );
    })
    .then((tableReads) =>
      Promise.all(tableReads).then((wasmTables) => {
        wasmTables.map((wasmTable) => {
          if (wasmTable?.reader?.numBatches > 0) {
            const binaryDataForDownload = writeGeoJSON(wasmTable.reader);

            // Nouvelle étape : convertir le buffer en JSON exploitable
            const geojsonText = new TextDecoder("utf-8").decode(
              binaryDataForDownload
            );
            const geojson = JSON.parse(geojsonText);
            const desiredClass = ["river", "ocean", "sea"];
            const newgeojson = {
              ...geojson,
              features: geojson.features.filter((feature) =>
                desiredClass.includes(feature.properties.class)
              ),
            };
            console.log(newgeojson);
            // Affiche-le maintenant sur Leaflet
            // 👉 tu peux stocker ce geojson dans un state pour le rendre dans un <GeoJSON />
            setGeoJsonData(newgeojson);
          }
        });
      })
    )
    .catch((error) => {
      // Something went wrong with the download.
      alert("An error occurred during the download: " + error);
    });
};
