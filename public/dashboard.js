document.getElementById('addLectureBtn').addEventListener('click', () => {
  fetch('/lectures', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
     subject: prompt('Enter subject'),
     faculty: prompt('Enter faculty'),
     start: prompt('Enter start time'),
     end: prompt('Enter end time'),
     date: new Date().toISOString().slice(0, 10)
   })
  })
  .then(response) => {
    if (response.ok) {
      fetch('/lectures').then(data => {
        document.getElementById('lecturesList').innerHTML = '';
        data.json().forEach(lecture => {
          document.getElementById('lecturesList').innerHTML += `<li>${lecture.subject}</li>`;
        });
      }));
    } else {
      throw new Error(response.statusText);
    }
  })
  .catch(error => console.error('Error:', error));
});