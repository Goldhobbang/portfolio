# Asset Credits & Provenance

## 1. 원본 3D 모델 (`assets/abyss/3dmodel/`)

본 장면의 모든 어류 3D 메시와 원본 텍스처는 작업 폴더 내 `assets/abyss/3dmodel/`에 업로드된 아래 3종의 Blender 파일을 별도의 절차적 도형 생성이나 대체 메시 추가 없이 그대로 사용하여 제작되었습니다. 원본 파일은 덮어쓰지 않고 보존하였습니다.

| 원본 파일 (`assets/abyss/3dmodel/`) | 파생 소스 (`assets/abyss/source/`) | 런타임 에셋 (`assets/abyss/`) | 정점 / 삼각형 수 | 기존 관절 유무 |
| --- | --- | --- | --- | --- |
| `Meshy_AI_Anglerfish_20260418_texture.blend` | `anglerfish.blend` | `anglerfish.glb` | 170,617 verts / 341,244 tris | 없음 (`armatures: []`) → 15본 리깅 추가 |
| `Meshy_AI_Shark_20260418_texture.blend` | `shark.blend` | `shark.glb` | 7,876 verts / 15,724 tris | 없음 (`armatures: []`) → 12본 리깅 추가 |
| `Meshy_AI_megalodon_shark_20250518_texture.blend` | `megalodon-shark.blend` | `megalodon-shark.glb` | 4,984 verts / 10,000 tris | 없음 (`armatures: []`) → 12본 리깅 추가 |

* 위 3종 모델은 사용자가 프로젝트에 직접 제공한 Meshy AI 생성 에셋이며, 외부 배포 시에는 제공자의 Meshy 계정 플랜 및 라이선스 정책을 따릅니다.
* 대형 백상아리·메갈로돈형 모델(`megalodon-shark.glb`)과 유영형 상어 모델(`shark.glb`)은 심해 고유종으로 생태학적 분류를 주장하지 않으며, 심해 연출 공간에 시각적 대비와 공간감을 위해 배치한 에셋입니다.

## 2. 심해 협곡 바닥 (`assets/abyss/trench-floor.glb`)

사용자가 제공한 `3dmodel/Meshy_AI_deep_sea_trench_diorama_complete_20261103_image-to-3d-texture.blend`를 심해 바닥으로 배치합니다. 302 MB Blender 원본은 그대로 보존하며, 웹 배포용 GLB는 `source/export_trench.py`로 메시를 약 6%로 줄이고 최대 2048px 텍스처로 내보냅니다. 장면에서 수평 스케일 48배로 확대하고 현재 관찰 위치 바로 아래에 고정합니다.

## 3. 리깅·애니메이션·재질 보정 (`assets/abyss/source/rig_models.py`)

* **도구**: Blender 5.2.3 LTS Python (`bpy`)
* **수행 작업**:
  * 원본 `Mesh_0` 지오메트리와 UV 좌표를 변형하거나 별도 기본 도형을 덧붙이지 않고 원형 그대로 유지하였습니다.
  * 각 모델의 해부학적 랜드마크(턱 관절, 유인돌기 줄기·미끼 끝단, 가슴지느러미·등지느러미·꼬리자루·꼬리지느러미)를 계측하여 전용 Armature 관절 계층과 메시 에지 그래프 기반 스무딩 웨이트(정점당 최대 4본 정규화)를 추가하였습니다.
  * 원본 패킹 ORM 텍스처(`Image_1`)의 Blue(Metallic) 채널이 `0.85~0.90`으로 설정되어 수중 조명 아래에서 검은 금속처럼 반사되던 문제를 비금속 생체 피부 범위(`0.02~0.05`)로 보정하고, 심해아귀 미끼 끝단(`Esca`) UV 영역에만 국소 발광 맵(`anglerfish_emissive.png`)을 적용하였습니다.

## 4. 런타임 라이브러리 라이선스

* `three.module.js`, `three.core.js` 및 `vendor/three-r180/` (`GLTFLoader.js`, `SkeletonUtils.js`, `OrbitControls.js`, `RoomEnvironment.js`, `BufferGeometryUtils.js`): Three.js `r180`, MIT License (`vendor/three-r180/LICENSE.txt` 참조). 외부 CDN 의존성 없이 로컬 파일로만 동작합니다.
