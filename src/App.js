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
    const lines =
      feature.geometry.type === "MultiLineString"
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];

    for (const coords of lines) {
      if (!coords || coords.length < 2) continue;
      const line = turf.lineString(coords);
      const snapped = turf.nearestPointOnLine(
        line,
        turf.point([point.lng, point.lat]),
        { units: "kilometers" }
      );

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
  let lines = [];
  for (const feature of geojson.features) {
    if (feature.geometry.type === "MultiLineString") {
      lines.push(...feature.geometry.coordinates);
    } else if (feature.geometry.type === "LineString") {
      lines.push(feature.geometry.coordinates);
    } else if (
      feature.geometry.type === "Polygon" ||
      feature.geometry.type === "MultiPolygon"
    ) {
      // const test = turf.polygonToLine(feature.geometry);
      // for (const f of test.features) {
      //   if (f.geometry.type === "MultiLineString") {
      //     lines.push(...f.geometry.coordinates);
      //   } else if (f.geometry.type === "LineString") {
      //     lines.push(f.geometry.coordinates);
      //   }
      // }
    }
  }
  const lastCoords = [];
  const firstCoords = [];
  for (const coords of lines) {
    lastCoords.push(coords[coords.length - 1]);
    firstCoords.push(coords[0]);
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const keyA = coordsKey(a);
      const keyB = coordsKey(b);
      const distance = turf.distance(turf.point(a), turf.point(b), {
        units: "kilometers",
      });

      if (!graph[keyA]) graph[keyA] = {};
      if (!graph[keyB]) graph[keyB] = {};

      graph[keyA][keyB] = distance;
      graph[keyB][keyA] = distance;
    }
  }

  lastCoords.forEach((lastCords) => {
    let closest = firstCoords[0];
    firstCoords.forEach((firstCords) => {
      const distance1 = turf.distance(
        turf.point(lastCords),
        turf.point(closest),
        {
          units: "kilometers",
        }
      );
      const distance2 = turf.distance(
        turf.point(lastCords),
        turf.point(firstCords),
        {
          units: "kilometers",
        }
      );
      if (distance1 < 3 && distance2 < 3 && distance2 < distance1) {
        closest = firstCords;
      }
    });
    const distance = turf.distance(turf.point(lastCords), turf.point(closest), {
      units: "kilometers",
    });
    const keyA = coordsKey(lastCords);
    const keyB = coordsKey(closest);
    if (!graph[keyA]) graph[keyA] = {};
    if (!graph[keyB]) graph[keyB] = {};

    graph[keyA][keyB] = distance;
    graph[keyB][keyA] = distance;
  });

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
    const densified = densifyMultiSegmentLine(points, 200); // tous les 200m
    const bounds = turf.bbox(
      turf.featureCollection(densified.map((p) => turf.point([p.lng, p.lat])))
    );
    const [minLng, minLat, maxLng, maxLat] = bounds;
    const margin = 0.05;
    const expandedBounds = [
      minLng - margin,
      minLat - margin,
      maxLng + margin,
      maxLat + margin,
    ];
    handleDownloadClick(expandedBounds, async (geojson) => {
      setRoadNetwork(geojson);

      const graph = geojsonToGraph(geojson);

      // const snappedCoords = densified.map((p) => snapToNetwork(p, geojson));
      const snappedCoords = densified
        .map((p) => findClosestGraphNode(p, graph))
        .filter(Boolean);

      const routeSegments = [];
      for (let i = 0; i < snappedCoords.length - 1; i++) {
        const segmentCoords = extractPathCoords(
          graph,
          snappedCoords[i],
          snappedCoords[i + 1]
        );
        if (segmentCoords.length > 1) {
          routeSegments.push(turf.lineString(segmentCoords));
        }
      }

      setRoutes(routeSegments);
    });
  };

  function densifyMultiSegmentLine(points, spacingMeters = 200) {
    if (points.length < 2) return points;

    const spacingKm = spacingMeters / 1000;
    const densified = [];

    for (let i = 0; i < points.length - 1; i++) {
      const start = [points[i].lng, points[i].lat];
      const end = [points[i + 1].lng, points[i + 1].lat];
      const line = turf.lineString([start, end]);
      const length = turf.length(line, { units: "kilometers" });

      for (let dist = 0; dist <= length; dist += spacingKm) {
        const pt = turf.along(line, dist, { units: "kilometers" });
        const [lng, lat] = pt.geometry.coordinates;

        // éviter les doublons
        if (
          densified.length === 0 ||
          densified[densified.length - 1].lat !== lat ||
          densified[densified.length - 1].lng !== lng
        ) {
          densified.push({ lat, lng });
        }
      }
    }

    return densified;
  }
  return (
    <div style={{ height: "100vh", width: "100%" }}>
      <MapContainer
        center={[48.8566, 2.3522]}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
      >
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
        <button
          onClick={handleFinish}
          style={{ position: "absolute", top: 10, left: 10, zIndex: 1000 }}
        >
          Terminer
        </button>
      )}
    </div>
  );
}
