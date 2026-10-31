# 조사: 사진으로 음식 칼로리를 추정하는 오픈소스 모델

2026-10-31 · 조사: 리서치 에이전트(웹 검색, Hugging Face Hub) · 결정: 02-SSRD IF-08 "서버의 모델 호출"

## 결론

피자 시연에는 지금 계획(Claude Haiku 5.5 + 고정표 폴백)을 그대로 쓴다. 오픈소스 모델로 바꾸지 않는다.

- **분류 모델은 더할 정보가 없다.** 감지기가 이미 `pizza`라고 알려 준다. 어려운 것은 한 조각인지 한 판인지 양을 판단하는 일이다. 그래서 프롬프트에서 양(`portion`)을 먼저 고르게 했다.
- **칼로리 회귀 모델은 대부분 Nutrition5k로 학습했다.** 구내식당 접시를 위에서 찍은 사진이다. 600kcal가 넘는 접시는 낮게 추정한다고 모델 카드에 적혀 있어, 피자 한 판에서는 크게 틀릴 가능성이 높다(추정). 256px 조각에는 크기 단서가 거의 없고, 64px는 더 나쁘다(추정).
- **오픈 VLM이 낫다는 근거를 찾지 못했다.** 단일 RGB 사진 806장 벤치마크([arXiv 2507.07048](https://arxiv.org/html/2507.07048v2))의 평균 절대 오차는 다음과 같다. Haiku를 직접 잰 값은 없다.
  - Qwen2.5-VL-72B: 276kcal
  - GPT-4o: 166kcal
  - Claude 3.7 Sonnet: 182kcal

## 후보

✅는 조사 에이전트가 페이지를 열어 확인한 것이고, 〜는 추정이다. 정확도는 모두 작성자가 스스로 보고한 값이다. 이 표의 숫자를 레포 작업자가 다시 확인하지는 않았다.

| 후보 | 출력 | 정확도 | 라이선스·크기 | 실행 환경 | 피자 |
| --- | --- | --- | --- | --- | --- |
| [Nutrition5k](https://github.com/google-research-datasets/Nutrition5k) | 데이터셋만, 가중치 없음 ✅ | 논문: RGB만 70.6kcal(26.1%), 깊이 정보를 더하면 47.6kcal ✅ | 데이터 CC BY 4.0, 2026-04 보관 처리 ✅ | — | — |
| [calorie-lens](https://huggingface.co/shalev396/calorie-lens) | kcal·질량·3대 영양소·재료별 g | 40.9kcal(16.0%) ✅ | MIT, 378MB ✅ | PyTorch만. 무료 ZeroGPU Space API ✅ | 학습 클래스에 `cheese pizza` 등 ✅ |
| [CalorieK](https://huggingface.co/Dralkh/CalorieK) | kcal·g·3대 영양소 | 56.3kcal. 학습 데이터 밖 사진에서는 181kcal ✅ | MIT, 375MB ✅ | PyTorch만. ONNX로 바꾸면 브라우저 가능 〜 | 미확인 |
| [CalorieCLIP](https://huggingface.co/jc-builds/CalorieCLIP) | kcal | 51.4kcal(제3자 재측정 126kcal) ✅ | MIT, 607MB ✅ | PyTorch | 미확인 |
| [dpf-nutrition](https://huggingface.co/T0MYYY/dpf-nutrition) | 깊이 예측 + RGB | 109kcal(제3자 재측정) | CC-BY-NC, 상업 이용 불가 ✅ | CoreML | 미확인 |
| [Food-R1](https://huggingface.co/zy12123/Food-R1) | 칼로리 추론 VLM | 77kcal(제3자 재측정) | Apache-2.0, 약 8B, bf16 17.5GB ✅ | 24GB급 GPU 필요. 3초 안에 답하기 어렵다 〜 | 미확인 |
| [Swin Food-101 ONNX](https://huggingface.co/onnx-community/swin-finetuned-food101-ONNX) | 분류만 | 정확도 92.1% | Apache-2.0, q4 53MB ✅ | transformers.js로 브라우저 실행 | 76번 클래스 `pizza` ✅ |

**찾아도 쓸 수 없던 것**
- im2calories(2015)는 코드나 가중치가 공개된 흔적이 없다.
- `NutriScan-3B`는 벤치마크와 라이선스 표기가 없다.
- `cemoss17/nutrition5k-qwen3-vl-4b`는 빈 저장소였다.

**배포 제약(추정)**
- Vercel Python 함수 한도는 500MB로 알려져 있다. 문서 원문은 열지 않았다.
- torch에 378MB 가중치를 더하면 이 한도를 넘을 가능성이 높다.

## 쓸 수 있는 보조 방안 (채택하지 않음)

calorie-lens Space를 결과를 기다리지 않는 참고값으로 붙일 수는 있다. 하지만 대기열과 사용량 제한 때문에 3초 안에 답한다는 보장이 없고, 조각 이미지를 제3자 서버로 하나 더 보내게 된다. 보장 3("허용한 곳에만 보낸다")의 설명이 복잡해지므로 이번 제출에서는 쓰지 않는다.
