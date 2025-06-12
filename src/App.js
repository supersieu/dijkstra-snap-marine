import React, { useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  useMapEvent,
  GeoJSON,
} from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";
import { handleDownloadClick } from "./utils/DownloadCatalog";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
import dijkstra from "dijkstrajs"; // npm install dijkstrajs

L.Marker.prototype.options.icon = L.icon({
  iconUrl,
  shadowUrl: iconShadow,
  iconAnchor: [12, 41],
});

function MapClickHandler({ onMapClick }) {
  useMapEvent("click", (e) => onMapClick(e.latlng));
  return null;
}

function coordsKey([lng, lat]) {
  return `${lng},${lat}`;
}

function keyToCoords(key) {
  return key.split(",").map(Number);
}
function findClosestGraphNode(point, graph) {
  const pt = turf.point([point.lng, point.lat]);
  let closest = null;
  let minDist = Infinity;

  for (const nodeKey of Object.keys(graph)) {
    const coords = keyToCoords(nodeKey);
    const nodePt = turf.point(coords);
    const dist = turf.distance(pt, nodePt, { units: "kilometers" });

    if (dist < minDist) {
      minDist = dist;
      closest = coords;
    }
  }

  return closest; // [lng, lat]
}


function snapToNetwork(point, geojson) {
  let nearest = null;
  let minDist = Infinity;

  for (const feature of geojson.features) {
    const lines = feature.geometry.type === "MultiLineString"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];

    for (const coords of lines) {
      if (!coords || coords.length < 2) continue;
      const line = turf.lineString(coords);
      const snapped = turf.nearestPointOnLine(line, turf.point([point.lng, point.lat]), { units: "kilometers" });

      if (snapped.properties.dist < minDist) {
        nearest = snapped;
        minDist = snapped.properties.dist;
      }
    }
  }

  return nearest.geometry.coordinates; // [lng, lat]
}

function geojsonToGraph(geojson) {
  const graph = {};

  for (const feature of geojson.features) {
    const lines = feature.geometry.type === "MultiLineString"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];

    for (const coords of lines) {
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i];
        const b = coords[i + 1];
        const keyA = coordsKey(a);
        const keyB = coordsKey(b);
        const distance = turf.distance(turf.point(a), turf.point(b), { units: "kilometers" });

        if (!graph[keyA]) graph[keyA] = {};
        if (!graph[keyB]) graph[keyB] = {};

        graph[keyA][keyB] = distance;
        graph[keyB][keyA] = distance;
      }
    }
  }

  return graph;
}

function extractPathCoords(graph, startCoord, endCoord) {
  const startKey = coordsKey(startCoord);
  const endKey = coordsKey(endCoord);
  const path = dijkstra.find_path(graph, startKey, endKey);
  return path.map(keyToCoords);
}

export default function App() {
  const [points, setPoints] = useState([]);
  const [roadNetwork, setRoadNetwork] = useState(null);
  const [routes, setRoutes] = useState([]);

  const handleMapClick = (latlng) => setPoints((prev) => [...prev, latlng]);

  const handleFinish = () => {
    const bounds = turf.bbox(turf.featureCollection(points.map(p =>
      turf.point([p.lng, p.lat])
    )));
    handleDownloadClick(bounds, async (geojson) => {
      setRoadNetwork(geojson);

      const graph = geojsonToGraph(geojson);

      // const snappedCoords = points.map((p) => snapToNetwork(p, geojson));
      const snappedCoords = points.map((p) => findClosestGraphNode(p, graph)).filter(Boolean);


      const routeSegments = [];
      for (let i = 0; i < snappedCoords.length - 1; i++) {
        const segmentCoords = extractPathCoords(graph, snappedCoords[i], snappedCoords[i + 1]);
        if (segmentCoords.length > 1) {
          routeSegments.push(turf.lineString(segmentCoords));
        }
      }

      setRoutes(routeSegments);
    });
  };

  return (
    <div style={{ height: "100vh", width: "100%" }}>
      <MapContainer center={[48.8566, 2.3522]} zoom={13} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <MapClickHandler onMapClick={handleMapClick} />

        {points.map((p, i) => (
          <Marker key={i} position={p} />
        ))}

        {roadNetwork && (
          <GeoJSON data={roadNetwork} style={{ color: "gray", weight: 1 }} />
        )}

        {routes.map((r, i) => (
          <GeoJSON key={i} data={r} style={{ color: "blue", weight: 4 }} />
        ))}
      </MapContainer>

      {points.length > 1 && (
        <button onClick={handleFinish} style={{ position: "absolute", top: 10, left: 10, zIndex: 1000 }}>
          Terminer
        </button>
      )}
    </div>
  );
}
