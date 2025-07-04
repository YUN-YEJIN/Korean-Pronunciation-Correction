from flask import Flask, request, jsonify, send_from_directory, send_file, render_template, abort, url_for
from werkzeug.utils import safe_join
import os
from openai import OpenAI
from dotenv import load_dotenv
import tempfile
from datetime import datetime

# API 키 가져오기(=로드)
load_dotenv()
openai_api_key = os.getenv("OPENAI_API_KEY")
app = Flask(__name__)

# 업로드 폴더 경로
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/')
@app.route('/speech.html')
def serve_html():
    return render_template('speech.html')

@app.route("/uploads/<filename>")
def get_uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# (마이크 켜서) 텍스트 받아오기 -> STT 기능
@app.route("/speak", methods=["POST"])
def speak():
    text = request.json.get("text")
    if not text:
        return jsonify({"error": "text field is required"}), 400

    try:
        client = OpenAI(api_key=openai_api_key)
        response = client.audio.speech.create(
            model="tts-1-hd",       # ✅ 올바른 TTS 모델
            voice="shimmer",        # ✅ 음성 스타일 shimmer
            input=text
        )
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
        temp_file.write(response.content)
        temp_file.close()
        return send_file(temp_file.name, mimetype="audio/mpeg")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# transcript 저장용 딕셔너리 (임시 메모리용 – 프로덕션에선 DB나 파일 권장)
transcript_store = {}

@app.route("/upload", methods=["POST"])
def upload_audio():
    # 1. 사용자가 보낸 오디오 파일과 STT 텍스트 받기
    audio = request.files.get("audio")
    transcript = request.form.get("transcript", "")

    # 원래 발음(raw transcript)를 그대로 유지
    raw_transcript = transcript
    if audio is None:
        return jsonify({"error": "No audio file provided"}), 400

    # 2. 오디오 파일을 고유 파일명(시간)으로 설정
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    filename = f"recording_{timestamp}.webm"
    
    # 3. 파일 저장
    save_path = os.path.join(UPLOAD_FOLDER, filename)
    audio.save(save_path)
    
    # 4. (시간에 따라 저장한) 파일에 제목으로 '발음한 문장'을 대입
    txt_path = os.path.join(UPLOAD_FOLDER, f"recording_{timestamp}.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(raw_transcript)

    # 5. GPT 호출해서 교정 (원본 발음 그대로 전달)
    answer = generate_correct_sentence(raw_transcript)

    # 6. 결과 반환 - 원본 발음과 교정된 문장 모두 반환
    return jsonify({
        "raw_transcript": raw_transcript,  # 원본 발음 그대로
        "answer": answer,                   # 교정된 문장
        "filename": filename
    })     
    
    
#저장된 파일 목록을 반환하는 API 추가
@app.route("/recordings")
def list_recordings():
    files = sorted(f for f in os.listdir(UPLOAD_FOLDER) if f.endswith(".webm"))
   
    #<저장된 문장>에 한글 제목으로 표시
    result = []
    for f in files:
        transcript_path = os.path.join(UPLOAD_FOLDER, f.replace(".webm", ".txt"))
        if os.path.exists(transcript_path):
            with open(transcript_path, "r", encoding="utf-8") as tfile:
                transcript = tfile.read().strip()
        else:
            transcript = "(내용 없음)"
        preview = transcript[:15] + "..." if len(transcript) > 15 else transcript
        result.append({ "filename": f, "preview": preview })

    return jsonify(result)   

@app.route("/audio/<filename>")
def get_specific_audio(filename):
    file_path = safe_join(UPLOAD_FOLDER, filename)
    if not os.path.exists(file_path):
        abort(404)
    return send_from_directory(UPLOAD_FOLDER, filename)

def generate_correct_sentence(user_text: str) -> str:

    """
    OpenAI GPT 모델을 사용해
    사용자 발화문장을 자연스럽고 올바른 한국어 문장으로 교정함
    """
    prompt = (
        f"사용자의 실제 발음: \"{user_text}\"\n"
        "이 발음을 올바른 한국어 문장으로 교정해주세요. 예를 들어 '거기마 먹고 시따'는 '고구마 먹고 싶다'로 교정해야 합니다.\n"
        "발음이 정확하지 않을 수 있으므로, 사용자가 의도했을 가능성이 높은 문장들로 교정한 문장 세 개를 주세요."
    )

    try:
        client = OpenAI(api_key=openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "너는 한국어 발음 교정을 돕는 교사야. 사용자의 부정확한 발음을 올바른 한국어 문장으로 교정해줘."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=100,
            temperature=0.3,
        )
        corrected_sentence = response.choices[0].message.content.strip()
        print(f"GPT 교정 결과: {corrected_sentence}")
        return corrected_sentence
    except Exception as e:
        print(f"GPT 호출 에러: {e}")
        return "죄송합니다. 문장 교정에 실패했습니다."

# <저장된 문장>에서 문장 삭제하기 기능
@app.route("/delete/<filename>", methods=["DELETE"])
def delete_recording(filename):
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    try:
        os.remove(filepath)
        transcript_store.pop(filename, None)  # 🔹 함께 삭제
        return jsonify({"status": "deleted"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
