//코드 흐름: 단어장 업데이트 -> 브라우저에서 음성녹음 -> 실시간 음성인식 -> 서버에 전송 -> 발음 교정 결과 수신 및 재생

// 전역 변수
let recognition;
let recordedChunks = [];   // 마이크로 녹음된 오디오 데이터 조각
let mediaRecorder;
let rawTranscript = "";   // 음성 인식 결과 텍스트
let gumStream;
// DOM 요소
const statusElement = document.getElementById("status");
const transcriptElement = document.getElementById("transcript");
const correctedElement = document.getElementById("corrected");
const correctedContainer = document.getElementById("corrected-container");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const debugInfoElement = document.getElementById("debug-info");
const pronunciationInput = document.getElementById("pronunciation-input");
const submitPronunciationButton = document.getElementById("submit-pronunciation");
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// 재생 관련 버튼, 오디오
const playOriginalBtn = document.getElementById('play-original');
const playCorrectedBtn = document.getElementById('play-corrected');
const originalAudio = document.getElementById('original-audio');

// // MediaRecorder로 녹음된 오디오 데이터 조각
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabId = tab.getAttribute('data-tab');

    // 모든 탭과 컨텐츠를 비활성화 
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

     // 선택한 탭과 컨텐츠를 활성화
    tab.classList.add('active');
    document.getElementById(`${tabId}-tab`).classList.add('active');
  });
});

 // 디버그 로그 함수(problem 추적용)
function logDebug(message) {
  console.log(message);
  debugInfoElement.style.display = "block";
  debugInfoElement.textContent += message + "\n";
  debugInfoElement.scrollTop = debugInfoElement.scrollHeight;
}

// Web Speech API 지원 확인
if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
  logDebug("이 브라우저는 Web Speech API를 지원하지 않습니다.");
  alert("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해주세요.");
  startButton.disabled = true;
}

//녹음 후 단어장 리스트 갱신
async function updateWordbookList() {
  const listElement = document.getElementById("saved-list");
  listElement.innerHTML = "";

// 서버에서 파일 목록 가져오기
  const res = await fetch("/recordings");
  const files = await res.json();

//파일 객체로 분해하는 코드
 files.forEach(({ filename, preview }) => {
    const li = document.createElement("li");

// 각 파일은 재생 버튼과 삭제 버튼을 가진다.
const playBtn = document.createElement("button");
playBtn.textContent = `▶ ${preview}`;
playBtn.onclick = () => {
    const audio = new Audio(`/uploads/${filename}`);
    audio.play();
    };
//삭제 버튼
const deleteBtn = document.createElement("button");
deleteBtn.textContent = "삭제";
deleteBtn.style.marginLeft = "0.5rem";
deleteBtn.onclick = async () => {
    const confirmed = confirm("이 항목을 삭제할까요?");
      if (!confirmed) return;
      const delRes = await fetch(`/delete/${filename}`, { method: "DELETE" });
      if (delRes.ok) {
        await updateWordbookList();
      } else {
        alert("삭제 실패");
      }
    };
   
    // 오디오 파일 목록 항목 구성
    li.appendChild(playBtn);
    li.appendChild(deleteBtn);
    listElement.appendChild(li);
  });
}

  // 녹음 시작
async function startRecording() {
  try {
    // Web Speech API 초기화
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';             // 한국어 인식
    recognition.continuous = true;          // 연속 인식
    recognition.interimResults = true;      // 중간 결과 표시 (미완성 발화도 보여줌)
        
    // 마이크 접근 (오디오 파일 저장용)
    logDebug("마이크 액세스 요청 중...");
    gumStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 녹음 설정
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(gumStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    // 녹음 시작
    mediaRecorder.start(1000);
    logDebug("녹음 시작됨");

    // Web Speech 결과 처리
    rawTranscript = "";

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalTranscript += transcript;
          rawTranscript += transcript + " ";
        } else {
          interimTranscript += transcript;
        }
      }
      // 결과 표시 (원시 발음 그대로)
      transcriptElement.innerText = rawTranscript + interimTranscript;
    };

    recognition.onerror = (event) => logDebug("인식 오류: " + event.error);

    // Web Speech API 시작
    recognition.start();

    // UI 업데이트
    startButton.disabled = true;
    stopButton.disabled = false;
    transcriptElement.innerText = "말씀해주세요...";
    correctedElement.innerText = "교정 대기 중...";
    correctedContainer.style.display = "none";
    statusElement.innerHTML = "녹음 중... <span class='loading'></span>";

  } catch (error) {
    logDebug("녹음 시작 오류: " + error.message);
    statusElement.innerText = "마이크 접근 오류: " + error.message;
  }
}

// 녹음 종료
function stopRecording() {
    // Web Speech API 중지
      recognition?.stop();
    // 녹음 종료
      mediaRecorder?.stop();
    // 오디오 트랙 종료
      gumStream?.getTracks().forEach(track => track.stop());

  // UI 업데이트
  startButton.disabled = false;
  stopButton.disabled = true;
  statusElement.innerHTML = "처리 중... <span class='loading'></span>";

  mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
    logDebug(`오디오 블롭 생성: ${Math.round(audioBlob.size / 1024)} KB`);
    await requestCorrection(rawTranscript, audioBlob);
  };
}

let latestFilename = "";  // 가장 마지막 업로드 파일명 저장

// 서버에 교정 요청
async function requestCorrection(text, audioBlob = null) {
  try {
    const formData = new FormData();

    if (audioBlob) {
          formData.append("audio", audioBlob, "recording.webm");
        } else {
          // 오디오 없이 텍스트만 보낼 경우 빈 파일 추가 (서버에서 오디오 파일 체크하므로)
          const emptyBlob = new Blob([''], { type: 'audio/webm' });
          formData.append("audio", emptyBlob, "empty.webm");
        }
    formData.append("transcript", text);

    statusElement.innerHTML = "교정 처리 중... <span class='loading'></span>";

     const res = await fetch("/upload", {
          method: "POST",
          body: formData
        });

     if (!res.ok) {
          const errorText = await res.text();
          logDebug(`교정 오류 응답: ${res.status} - ${errorText}`);
          throw new Error(`교정 오류: ${res.status}`);
        }

    const result = await res.json();
    latestFilename = result.filename; 

    // 결과 표시 - 원본 발음과 교정된 문장 모두 표시
    transcriptElement.innerText = result.raw_transcript || text;
    correctedElement.innerText = result.answer;
    correctedContainer.style.display = "block";
    statusElement.innerText = "교정 완료!";
    playOriginalBtn.disabled = false;

  } catch (error) {
    logDebug("처리 오류: " + error.message);
    statusElement.innerText = "오류 발생: " + error.message;
  }
  await updateWordbookList();
}
//<내가 말한 문장 듣기> 버튼 실행
playOriginalBtn.addEventListener('click', () => {
  if (!latestFilename) {
    alert("재생할 오디오가 없습니다.");
    return;
  }
  const audio = document.getElementById('recordedAudio');
  audio.src = `/uploads/${latestFilename}?ts=` + Date.now();  // 🔥 실제 경로로
  audio.load();
  audio.play();
});
    document.addEventListener("DOMContentLoaded", () => {
      // 녹음 시작 버튼
      startButton.onclick = startRecording;
      // 녹음 종료 버튼
      stopButton.onclick = () => {
        stopRecording();
        
        // 서버에 녹음 데이터 전송
        mediaRecorder.onstop = async () => {
          // 녹음된 데이터를 Blob으로 변환
          const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
          logDebug(`오디오 블롭 생성: ${Math.round(audioBlob.size / 1024)} KB`);
          
          // 교정 요청
          await requestCorrection(rawTranscript, audioBlob);
        };
      };

  // 텍스트 직접 입력 교정
  submitPronunciationButton.onclick = async () => {
    const text = pronunciationInput.value.trim();
    if (text) {
      transcriptElement.innerText = text;
      await requestCorrection(text);
    } else {
      alert("발음을 입력해주세요.");
    }
  };
  pronunciationInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitPronunciationButton.click();
  });
  
  //교정된 문장별 TTS 듣기 버튼
 function playTTS(index) {
    const correctedText = document.getElementById("corrected").innerText;
    const lines = correctedText.split('\n').filter(line => line.trim().match(/^\d\./));
    if (index < 1 || index > lines.length) return;

    const sentence = lines[index - 1].replace(/^\d+\.\s*/, "").trim();

    fetch("/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence })
    }).then(res => res.blob()).then(blob => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    });
  }
  function addTTSButtons() {
    const correctedBox = document.getElementById("corrected-container");
    let ttsBtnBox = document.getElementById("tts-buttons");
    if (!ttsBtnBox) {
      ttsBtnBox = document.createElement("div");
      ttsBtnBox.id = "tts-buttons";
      ttsBtnBox.style.marginTop = "1rem";
      correctedBox.appendChild(ttsBtnBox);
    }
    ttsBtnBox.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const btn = document.createElement("button");
      btn.innerText = `▶ 문장 ${i} 듣기`;
      btn.onclick = () => playTTS(i);
      ttsBtnBox.appendChild(btn);
    }
  }

  //교정된 텍스트 변경시 자동으로 TTS 버튼 삽입
   const ttsObserver = new MutationObserver(() => {
    const text = document.getElementById("corrected").innerText;
    if (text.includes("1.")) addTTSButtons();
  });
  ttsObserver.observe(document.getElementById("corrected"), { childList: true, subtree: true });

  });
