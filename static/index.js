//icone https://icons8.it/icon/set/meteo/fluency
//https://uiverse.io/
//https://newsapi.org/


$(document).ready(function () {
    let filtro2Value = $('#filtro2');
    let filtro3Value = $('#filtro3');
    let filtro4Value = $('#filtro4');

    const fornitori = [
        { id: 1, nome: 'Fornitore A' },
        { id: 2, nome: 'Fornitore B' },
        { id: 3, nome: 'Fornitore C' }
    ];

    const marche = [
        { id: 1, nome: 'Marca A' },
        { id: 2, nome: 'Marca B' },
        { id: 3, nome: 'Marca C' }
    ];

    // Carica fornitori nella select
    fornitori.forEach(fornitore => {
        $('#filtro2').append(`<option value="${fornitore.id}">${fornitore.nome}</option>`);
    });

    // Carica marche nella select
    marche.forEach(marca => {
        $('#filtro3').append(`<option value="${marca.id}">${marca.nome}</option>`);
    });

    const suggestionsData = [
        'Titolo 1',
        'Titolo 2',
        'EAN123456',
        'CodiceReady1',
        'CodiceReady2',
        'Supercalifragilistichespiralidoso Supercalifragilistichespiralidoso',
        'Marca A',
        'Marca B',
    ];

    function showSuggestions(value) {
        const filteredSuggestions = suggestionsData.filter(suggestion =>
            suggestion.toLowerCase().includes(value.toLowerCase())
        );

        $('#suggestions').empty(); // Pulisci i suggerimenti precedenti

        if (filteredSuggestions.length > 0) {
            filteredSuggestions.forEach(suggestion => {
                $('#suggestions').append(`<div class="suggestion-item">${suggestion}</div>`);
            });
            $('#suggestions').show(); // Mostra i suggerimenti
        } else {
            $('#suggestions').hide(); // Nasconde se non ci sono suggerimenti
        }
    }

    // Utilizza l'evento 'input' per cercare i suggerimenti mentre si digita
    $('#filtro1').on('input', function () {
        const value = $(this).val();
        if (value.length > 0) {
            showSuggestions(value);
        } else {
            $('#suggestions').hide(); // Nasconde se l'input è vuoto
        }
    });

    // Gestisci il clic sui suggerimenti
    $(document).on('click', '.suggestion-item', function () {
        $('#filtro1').val($(this).text()); // Imposta il valore dell'input
        $('#suggestions').hide(); // Nasconde i suggerimenti
    });

    // Gestione del submit
    $('#filterForm').on('submit', function (event) {
        event.preventDefault();

        // Ottieni i valori dei filtri
        filtro2Value = $('#filtro2').val();
        filtro3Value = $('#filtro3').val();
        filtro4Value = $('#filtro4').val();

        // Crea un oggetto con i valori dei filtri
        const filters = {
            fornitore: filtro2Value,
            marca: filtro3Value,
            filtro3: filtro4Value,
        };

        // Esegui azioni con i dati
        console.log('Filtri applicati:', filters);
    });
});