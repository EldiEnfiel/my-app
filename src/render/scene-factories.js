import * as THREE from "three";

export function createStars() {
  const starCount = 6500;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const color = new THREE.Color();

  for (let i = 0; i < starCount; i += 1) {
    const radius = THREE.MathUtils.randFloat(18, 90);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    const sinPhi = Math.sin(phi);
    const index = i * 3;

    positions[index] = radius * sinPhi * Math.cos(theta);
    positions[index + 1] = radius * Math.cos(phi);
    positions[index + 2] = radius * sinPhi * Math.sin(theta);

    color.setHSL(
      THREE.MathUtils.randFloat(0.5, 0.64),
      THREE.MathUtils.randFloat(0.08, 0.22),
      THREE.MathUtils.randFloat(0.72, 0.98)
    );

    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.095,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    vertexColors: true,
  });

  const starField = new THREE.Points(geometry, material);
  starField.name = "stars";

  return starField;
}

export function createEarthMaterial(dayMap, lightsMap, reliefMap) {
  return new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap },
      lightsMap: { value: lightsMap },
      reliefMap: { value: reliefMap },
      hiResMap: { value: dayMap },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      focusDirection: { value: new THREE.Vector3(0, 0, 1) },
      hiResBounds: { value: new THREE.Vector4(-180, -90, 180, 90) },
      texelSize: {
        value: new THREE.Vector2(
          1 / dayMap.image.width,
          1 / dayMap.image.height
        ),
      },
      detailStrength: { value: 0 },
      hiResMix: { value: 0 },
      hiResOpacity: { value: 0 },
      mapModeMix: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;

      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D dayMap;
      uniform sampler2D lightsMap;
      uniform sampler2D reliefMap;
      uniform sampler2D hiResMap;
      uniform vec3 sunDirection;
      uniform vec3 focusDirection;
      uniform vec4 hiResBounds;
      uniform vec2 texelSize;
      uniform float detailStrength;
      uniform float hiResMix;
      uniform float hiResOpacity;
      uniform float mapModeMix;

      varying vec2 vUv;
      varying vec3 vWorldNormal;

      float getHiResMask(vec2 sampleUv) {
        float latitude = sampleUv.y * 180.0 - 90.0;
        float longitude = sampleUv.x * 360.0 - 180.0;
        float hiResWidth = max(hiResBounds.z - hiResBounds.x, 0.0001);
        float hiResHeight = max(hiResBounds.w - hiResBounds.y, 0.0001);
        vec2 hiResUv = vec2(
          (longitude - hiResBounds.x) / hiResWidth,
          (latitude - hiResBounds.y) / hiResHeight
        );
        float hiResInside =
          step(hiResBounds.x, longitude) *
          step(longitude, hiResBounds.z) *
          step(hiResBounds.y, latitude) *
          step(latitude, hiResBounds.w);
        float hiResEdge = min(
          min(hiResUv.x, 1.0 - hiResUv.x),
          min(hiResUv.y, 1.0 - hiResUv.y)
        );

        return hiResInside * smoothstep(0.03, 0.18, hiResEdge) * hiResMix;
      }

      float getOceanMask(vec3 sampleColor) {
        float blueDominance = sampleColor.b - max(sampleColor.r, sampleColor.g);
        float cyanBias = sampleColor.g - sampleColor.r;
        float coolWeight = dot(sampleColor, vec3(0.18, 0.34, 0.48));
        float warmWeight = dot(sampleColor, vec3(0.52, 0.31, 0.17));
        float oceanSignal =
          blueDominance * 1.75 +
          cyanBias * 0.55 +
          coolWeight * 0.18 -
          warmWeight * 0.1;

        return smoothstep(-0.05, 0.16, oceanSignal);
      }

      vec3 getSimplifiedMapColor(vec2 uv, vec3 baseAlbedo) {
        float latitudeRatio = abs(uv.y * 2.0 - 1.0);
        float oceanMask = getOceanMask(baseAlbedo);
        vec3 reliefSample = texture2D(reliefMap, uv).rgb;
        float elevation = dot(reliefSample, vec3(0.2, 0.55, 0.25));
        float dryness = smoothstep(0.12, 0.38, baseAlbedo.r - baseAlbedo.g * 0.78);
        float lushness = smoothstep(0.1, 0.32, baseAlbedo.g - baseAlbedo.r * 0.65);
        vec3 landLow = vec3(0.32, 0.39, 0.29);
        vec3 landHigh = vec3(0.61, 0.58, 0.45);
        vec3 lushTint = vec3(0.25, 0.38, 0.24);
        vec3 aridTint = vec3(0.67, 0.58, 0.39);
        vec3 polarTint = vec3(0.78, 0.81, 0.82);
        vec3 oceanDeep = vec3(0.13, 0.24, 0.34);
        vec3 oceanShallow = vec3(0.34, 0.46, 0.57);
        vec3 land = mix(landLow, landHigh, smoothstep(0.16, 0.82, elevation));
        land = mix(land, lushTint, lushness * 0.32);
        land = mix(land, aridTint, dryness * 0.42);
        land = mix(land, polarTint, smoothstep(0.72, 0.96, latitudeRatio) * 0.58);
        vec3 ocean = mix(
          oceanDeep,
          oceanShallow,
          smoothstep(0.18, 0.58, baseAlbedo.g + baseAlbedo.b)
        );

        return mix(land, ocean, oceanMask);
      }

      vec3 sampleSurfaceColor(vec2 sampleUv) {
        vec2 uv = vec2(fract(sampleUv.x), clamp(sampleUv.y, 0.001, 0.999));
        float latitude = uv.y * 180.0 - 90.0;
        float longitude = uv.x * 360.0 - 180.0;
        vec3 baseAlbedo = texture2D(dayMap, uv).rgb;
        baseAlbedo = mix(
          baseAlbedo,
          getSimplifiedMapColor(uv, baseAlbedo),
          mapModeMix
        );
        float hiResWidth = max(hiResBounds.z - hiResBounds.x, 0.0001);
        float hiResHeight = max(hiResBounds.w - hiResBounds.y, 0.0001);
        vec2 hiResUv = vec2(
          (longitude - hiResBounds.x) / hiResWidth,
          (latitude - hiResBounds.y) / hiResHeight
        );
        vec4 hiResSample = texture2D(
          hiResMap,
          clamp(hiResUv, vec2(0.001), vec2(0.999))
        );
        float hiResAlpha = hiResOpacity * hiResSample.a * getHiResMask(uv);

        return mix(baseAlbedo, hiResSample.rgb, hiResAlpha);
      }

      void main() {
        vec3 albedo = sampleSurfaceColor(vUv);
        vec3 lights = texture2D(lightsMap, vUv).rgb;
        vec3 normal = normalize(vWorldNormal);
        vec3 lightDirection = normalize(sunDirection);
        vec3 focusVector = normalize(focusDirection);
        float focusAlignment = dot(normal, focusVector);
        float hiResMask = getHiResMask(vUv);
        float outerDot = cos(mix(0.58, 0.24, detailStrength));
        float innerDot = cos(mix(0.30, 0.12, detailStrength));
        float detailMask =
          smoothstep(outerDot, innerDot, focusAlignment) * detailStrength;
        vec2 detailOffset = texelSize * mix(2.4, 0.8, detailStrength);
        vec2 coastlineOffset = texelSize * mix(4.0, 1.6, detailStrength);
        vec3 north = sampleSurfaceColor(vUv + vec2(0.0, detailOffset.y));
        vec3 south = sampleSurfaceColor(vUv - vec2(0.0, detailOffset.y));
        vec3 east = sampleSurfaceColor(vUv + vec2(detailOffset.x, 0.0));
        vec3 west = sampleSurfaceColor(vUv - vec2(detailOffset.x, 0.0));
        vec3 northEast = sampleSurfaceColor(vUv + detailOffset);
        vec3 northWest = sampleSurfaceColor(vUv + vec2(-detailOffset.x, detailOffset.y));
        vec3 southEast = sampleSurfaceColor(vUv + vec2(detailOffset.x, -detailOffset.y));
        vec3 southWest = sampleSurfaceColor(vUv - detailOffset);
        float oceanCenter = getOceanMask(albedo);
        float oceanNorth = getOceanMask(sampleSurfaceColor(vUv + vec2(0.0, coastlineOffset.y)));
        float oceanSouth = getOceanMask(sampleSurfaceColor(vUv - vec2(0.0, coastlineOffset.y)));
        float oceanEast = getOceanMask(sampleSurfaceColor(vUv + vec2(coastlineOffset.x, 0.0)));
        float oceanWest = getOceanMask(sampleSurfaceColor(vUv - vec2(coastlineOffset.x, 0.0)));
        float coastlineContrast = (
          abs(oceanCenter - oceanNorth) +
          abs(oceanCenter - oceanSouth) +
          abs(oceanCenter - oceanEast) +
          abs(oceanCenter - oceanWest)
        ) * 0.25;
        vec3 neighborhood = (
          north + south + east + west +
          northEast + northWest + southEast + southWest
        ) / 8.0;
        vec3 sharpened = clamp(albedo * 1.92 - neighborhood * 0.92, 0.0, 1.0);
        vec3 relief = texture2D(reliefMap, vUv).rgb * 2.0 - 1.0;
        float reliefAccent = dot(
          normalize(vec3(relief.rg * 0.95, relief.b + 0.25)),
          normalize(vec3(0.45, 0.35, 1.0))
        );
        sharpened *= 0.95 + reliefAccent * 0.08;
        albedo = mix(albedo, sharpened, detailMask * (1.0 - hiResMask));
        float solar = dot(normal, lightDirection);
        float daylight = smoothstep(-0.18, 0.14, solar);
        float midday = smoothstep(0.02, 0.88, solar);
        float twilight =
          smoothstep(-0.24, 0.03, solar) *
          (1.0 - smoothstep(0.03, 0.28, solar));
        float darkness = clamp((-solar + 0.02) / 1.02, 0.0, 1.0);
        darkness = smoothstep(0.0, 1.0, darkness);
        float evening = 1.0 - smoothstep(-0.06, 0.2, solar);
        vec3 nightColor = albedo * vec3(0.07, 0.09, 0.13);
        vec3 dayColor = albedo * (0.98 + 0.72 * midday);
        vec3 sunsetColor = albedo * vec3(1.12, 0.78, 0.54);
        vec3 color = mix(nightColor, dayColor, daylight);
        color = mix(color, max(color, sunsetColor), twilight * 0.38);
        float lightsLuma = dot(lights, vec3(0.2126, 0.7152, 0.0722));
        float emergenceThreshold = mix(0.68, 0.05, evening);
        float buildingActivation = smoothstep(emergenceThreshold, 1.0, lightsLuma);
        float lightsStrength = evening * (0.12 + 2.35 * darkness * darkness);
        vec3 cityLights = lights * buildingActivation * lightsStrength;
        float coastlineGlow =
          smoothstep(0.09, 0.22, coastlineContrast) *
          smoothstep(0.18, 0.95, darkness);
        vec3 coastlineColor =
          mix(vec3(0.15, 0.24, 0.35), vec3(0.78, 0.9, 1.0), coastlineGlow) *
          (0.28 + 0.65 * coastlineGlow);
        color += coastlineColor * coastlineGlow;
        color += cityLights;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function createCloudMaterial(cloudMap) {
  return new THREE.ShaderMaterial({
    uniforms: {
      cloudMap: { value: cloudMap },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;

      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D cloudMap;
      uniform vec3 sunDirection;

      varying vec2 vUv;
      varying vec3 vWorldNormal;

      void main() {
        float cloudMask = texture2D(cloudMap, vUv).a;
        vec3 normal = normalize(vWorldNormal);
        vec3 lightDirection = normalize(sunDirection);
        float solar = dot(normal, lightDirection);
        float daylight = smoothstep(-0.22, 0.16, solar);
        float twilight =
          smoothstep(-0.24, 0.02, solar) *
          (1.0 - smoothstep(0.02, 0.24, solar));
        float alpha = cloudMask * (0.05 + daylight * 0.34 + twilight * 0.06);
        vec3 nightColor = vec3(0.16, 0.2, 0.28);
        vec3 dayColor = vec3(0.96, 0.985, 1.0);
        vec3 sunsetColor = vec3(0.95, 0.68, 0.48);
        vec3 color = mix(nightColor, dayColor, daylight);
        color = mix(color, sunsetColor, twilight * 0.26);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

export function createAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sunDirection;

      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(viewDirection, vWorldNormal), 0.0), 3.4);
        float solar = dot(normalize(vWorldNormal), normalize(sunDirection));
        float daylight = smoothstep(-0.15, 0.2, solar);
        vec3 color = mix(vec3(0.02, 0.05, 0.12), vec3(0.34, 0.67, 0.96), daylight);
        gl_FragColor = vec4(color, fresnel * mix(0.1, 0.26, daylight));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
}
