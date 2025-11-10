// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoidDJoYXJtb24iLCJhIjoiY21ocno1cGl1MGtkdTJscHNjdDBtdm93bSJ9.08umfzT5pLBKRnfRWzRVFA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/outdoors-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});


let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });


  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#1f11e0',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });
  
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#1f11e0',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });


  let jsonData;
  try {

    const jsonurl = "./data/bluebikes-stations.json";
  
    // Await JSON fetch
    const jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData); // Log to verify structure

    let trips = await d3.csv(
      './data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
  let startedMinutes = minutesSinceMidnight(trip.started_at);
  // This function returns how many minutes have passed since `00:00` (midnight).
  departuresByMinute[startedMinutes].push(trip);
  // Add the trip to the arrivals bucket using the trip's end time (was previously using started_at by mistake)
  let endedMinutes = minutesSinceMidnight(trip.ended_at);
  arrivalsByMinute[endedMinutes].push(trip);

        return trip;
      },
    );
    
    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
    const stations = computeStationTraffic(jsonData.data.stations, -1);
    console.log('Stations Array:', stations);

    const svg = d3.select('#map').select('svg');
    // Append circles to the SVG for each station
    // Only create circles for stations that have traffic (> 0)
    const circles = svg
      .selectAll('circle')
      .data(stations.filter(d => d.totalTraffic > 0), (d) => d.short_name)
      .enter()
      .append('circle')
      .attr('class', 'circle')
      .attr('r', 5) // Radius of the circle
      .attr('stroke', 'white') // Circle border color
      .attr('stroke-width', 1) // Circle border thickness
      .attr('opacity', 0.8) // Circle opacity
      .each(function (d) {
        // Add <title> for browser tooltips
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
      }).style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
      // Update positions for all currently-rendered circles
      svg.selectAll('circle')
        .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
        .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends
  
    // const trips = await d3.csv('./data/bluebikes-traffic-2024-03.csv');

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    svg.selectAll('circle')
      .data(stations.filter(d => d.totalTraffic > 0), d => d.short_name)
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('fill', 'var(--color)')
      .attr('opacity', 0.7)
      .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );


    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    // console.log("timeslider", timeSlider)
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

    function updateTimeDisplay() {
      let timeFilter = Number(timeSlider.value); // Get slider value

      if (timeFilter === -1) {
        selectedTime.textContent = ''; // Clear time display
        anyTimeLabel.style.display = 'block'; // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = 'none'; // Hide "(any time)"
      }

      // Call updateScatterPlot to reflect the changes on the map
      updateScatterPlot(timeFilter);
    }
    
    function minutesSinceMidnight(date) {
      return date.getHours() * 60 + date.getMinutes();
    }

    function updateScatterPlot(timeFilter) {
      // Get only the trips that match the selected time filter
      const filteredTrips = filterByMinute(trips, timeFilter);

      // Recompute station traffic based on the filtered trips
      const filteredStations = computeStationTraffic(stations, timeFilter);
      timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
      // Update the scatterplot by adjusting the radius of circles.
      // Only render stations that currently have traffic (>0).
      svg.selectAll('circle')
        .data(filteredStations.filter(d => d.totalTraffic > 0), d => d.short_name)
        .join(
          enter => enter.append('circle').attr('class', 'circle').attr('stroke', 'white').attr('stroke-width', 1).attr('opacity', 0.8)
            .each(function (d) { d3.select(this).append('title').text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`); }),
          update => update,
          exit => exit.remove()
        )
        .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
        .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic))
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
      }








  } catch (error) {
    console.error('Error loading JSON:', error); // Handle errors
  }


});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, timeFilter = -1) {
  // Retrieve filtered trips efficiently
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Update station data with filtered counts
  return stations = stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}







