class FormulaireLowreka extends HTMLElement {
  constructor() {
    super();
    console.log("FormulaireLowreka: Constructor appelé. (Instance créée)");

    // Sélection des éléments DOM 
    this.form = this.querySelector("#airtable-multi-step-form"); // Le formulaire
    this.formProgressBar = this.querySelector("#form-progress-bar"); // Barre de progression 
    this.dynamicFormStepsContainer = this.querySelector('#dynamic-form-steps');
    this.resetFormLink = this.querySelector('#reset-form-link'); 
    this.formStatusMain = this.querySelector('#form-status'); 

    // Initialisation des états internes de la classe
    this.formSteps = []; // Sera peuplé après le rendu initial et dynamique
    this.formProgressBarSteps = [];
    this.progressSegments = [];
    this.currentStepIndex = 0;
    this.formDataCollected = {};
    this.dynamicQuestionsData = []; // Contiendra les questions du backend
    this.questionsLoaded = false; // Drapeau pour s'assurer que les questions ne sont chargées qu'une fois

    this.getQuestionsNetlifyUrl = 'https://lowreka.netlify.app/.netlify/functions/get-form-questions';
    this.sendFormDataNetlifyUrl = 'https://lowreka.netlify.app/.netlify/functions/send-to-airtable';

    // Liaison des méthodes pour s'assurer que 'this' fait toujours référence à l'instance de la classe
    this.initializeForm = this.initializeForm.bind(this);
    this.showStep = this.showStep.bind(this);
    this.updateProgressBar = this.updateProgressBar.bind(this);
    this.validateStep = this.validateStep.bind(this);
    this.collectDataForStep = this.collectDataForStep.bind(this);
    this.generateSummary = this.generateSummary.bind(this);
    this.generateProgressBar = this.generateProgressBar.bind(this);
    this.updateButtons = this.updateButtons.bind(this);
    this.handleNextClick = this.handleNextClick.bind(this);
    this.handlePrevClick = this.handlePrevClick.bind(this);
    this.resetForm = this.resetForm.bind(this);
    this.handleFormSubmit = this.handleFormSubmit.bind(this);
    this.generateInputField = this.generateInputField.bind(this);
    this.renderDynamicSteps = this.renderDynamicSteps.bind(this);
    this.isValidEmail = this.isValidEmail.bind(this);
  }

  /**
   * Appelé lorsque l'élément est ajouté au DOM.
   * C'est le point d'entrée principal pour l'initialisation du formulaire.
   */
  async connectedCallback() {
    console.log("ConnectedCallback appelé");

    // Ajout des écouteurs d'événements initiaux
    if (this.form) {
      this.form.addEventListener("submit", this.handleFormSubmit);
    }
    if (this.resetFormLink) {
      this.resetFormLink.addEventListener('click', this.resetForm);
    }

    // Lance le chargement des questions et la construction des étapes dynamiques
    await this.initializeForm();

    // Après l'initialisation et le rendu dynamique, affiche la première étape
    this.showStep(this.currentStepIndex);

    // Initialise les boutons après que toutes les étapes soient rendues
    this.updateButtons();
  }

  /**
   * Appelé lorsque l'élément est retiré du DOM.
   * Nettoie les écouteurs d'événements pour éviter les fuites de mémoire.
   */
  disconnectedCallback() {
    console.log("FormulaireLowreka: disconnectedCallback appelé. Nettoyage.");
    if (this.form) {
      this.form.removeEventListener("submit", this.handleFormSubmit);
      this.form.querySelectorAll('.next-step').forEach(button => button.removeEventListener('click', this.handleNextClick));
      this.form.querySelectorAll('.prev-step').forEach(button => button.removeEventListener('click', this.handlePrevClick));
    }
    if (this.resetFormLink) {
      this.resetFormLink.removeEventListener('click', this.resetForm);
    }
  }

  /**
   * Charge les questions du backend (Netlify Function), les traite et rend les étapes dynamiques.
   */
  async initializeForm() {
    if (this.questionsLoaded) {
      console.log("Questions déjà chargées, initialisation ignorée.");
      return;
    }

    try {
      const response = await fetch(this.getQuestionsNetlifyUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const questionsFromServer = await response.json();
      console.log('Données des questions reçues du serveur:', questionsFromServer);

      if (Array.isArray(questionsFromServer)) {
        this.dynamicQuestionsData.length = 0; // Vider les données existantes

        questionsFromServer.forEach(q => {
          const question = {
            id_question: q.id_question,
            etape: q.etape,
            indicateur_questions: q.indicateur_questions,
            titre: q.titre,
            type_questions: q.type_questions,
            coeff_questions: q.coeff_questions || 0,
            categorie_questions: q.categorie_questions || '',
            options: q.options ? q.options.split(',').map(opt => opt.trim()) : [],
            description: q.description || '',
            obligatoire: q.obligatoire === true,
            ordre: q.ordre || 0
          };

          if (question.id_question && question.titre && question.indicateur_questions && question.type_questions && question.etape !== undefined) {
            this.dynamicQuestionsData.push(question);
          } else {
            console.warn("Question ignorée car des champs essentiels sont manquants ou indéfinis:", q);
          }
        });

        this.dynamicQuestionsData.sort((a, b) => {
          if (a.etape !== b.etape) {
            return parseInt(a.etape) - parseInt(b.etape);
          }
          return (a.ordre || 0) - (b.ordre || 0);
        });

        console.log('Questions traitées pour le formulaire (triées et complétées):', this.dynamicQuestionsData);

        this.renderDynamicSteps(); // Rendre les étapes après le chargement et le tri des questions
        this.questionsLoaded = true; // Marquer les questions comme chargées
      } else {
        console.error("Structure de données inattendue du serveur:", questionsFromServer);
        this.formStatusMain.textContent = 'Erreur: Structure de données inattendue reçue du serveur.';
        this.formStatusMain.className = 'form-status error';
      }
    } catch (error) {
      console.error('Erreur lors du chargement des questions:', error);
      this.formStatusMain.textContent = 'Erreur: Impossible de charger les questions du formulaire. Veuillez réessayer plus tard.';
      this.formStatusMain.className = 'form-status error';
    }
  }

  /**
   * Génère le HTML pour un champ de formulaire individuel basé sur les données de la question.
   * @param {Object} question - L'objet question du backend.
   * @returns {string} Le code HTML du champ de formulaire.
   */
  generateInputField(question) {
    let inputHtml = '';
    const name = question.indicateur_questions;
    const id = `question-${question.id_question}`;
    const requiredAttr = question.obligatoire ? 'required' : '';
    const errorHtml = '<div class="form-field-error-message"></div>';

    switch (question.type_questions) {
      case 'singleLineText':
      case 'email':
      case 'number':
        const inputType = question.type_questions === 'number' ? 'number' : (question.type_questions === 'email' ? 'email' : 'text');
        inputHtml = `<input type="${inputType}" id="${id}" name="${name}" ${requiredAttr} step="any">`;
        break;
      case 'multilineText':
        inputHtml = `<textarea id="${id}" name="${name}" rows="5" ${requiredAttr}></textarea>`;
        break;
      case 'singleSelect':
      case 'radio':
        inputHtml = `<div class="radio-group">`; // Utiliser 'radio-group' pour la sémantique
        if (question.options && question.options.length > 0) {
          question.options.forEach(option => {
            const optionId = `${id}-${option.replace(/\s+/g, '-').toLowerCase()}`;
            inputHtml += `
              <input type="radio" id="${optionId}" name="${name}" value="${option}" ${requiredAttr}>
              <label for="${optionId}">${option}</label><br>
            `;
          });
        } else {
          console.warn(`Type '${question.type_questions}' nécessite des options, mais aucune n'est fournie pour la question: ${question.titre}.`);
          inputHtml += `<p style="color:red;">Options manquantes pour cette question.</p>`;
        }
        inputHtml += `</div>`;
        break;
      case 'checkbox':
        inputHtml = `<div class="checkbox-group">`;
        if (question.options && question.options.length > 0) {
          question.options.forEach(option => {
            const optionId = `${id}-${option.replace(/\s+/g, '-').toLowerCase()}`;
            inputHtml += `
              <input type="checkbox" id="${optionId}" name="${name}" value="${option}" ${requiredAttr}>
              <label for="${optionId}">${option}</label><br>
            `;
          });
        } else {
          console.warn(`Type '${question.type_questions}' nécessite des options, mais aucune n'est fournie pour la question: ${question.titre}.`);
          inputHtml += `
              <input type="checkbox" id="${id}" name="${name}" value="Oui" ${requiredAttr}>
              <label for="${id}">Oui</label>
          `;
        }
        inputHtml += `</div>`;
        break;
      case 'date':
        inputHtml = `<input type="date" id="${id}" name="${name}" ${requiredAttr}>`;
        break;
      default:
        console.warn(`Type de question non géré: ${question.type_questions} pour la question: ${question.titre}`);
        inputHtml = `<input type="text" id="${id}" name="${name}" ${requiredAttr} placeholder="Type non géré">`;
    }

    return `
      <div class="form-field ${question.type_questions === 'multilineText' ? 'full-width' : ''}">
        <label for="${id}">${question.titre}</label>
        ${question.description ? `<p class="question-description">${question.description}</p>` : ''}
        ${inputHtml}
        ${errorHtml}
      </div>
    `;
  }

  /**
   * Rend les étapes dynamiques du formulaire basées sur les questions chargées.
   */
  renderDynamicSteps() {
    const stepsByStage = {};
    this.dynamicQuestionsData.forEach(q => {
      const etape = q.etape;
      if (!stepsByStage[etape]) {
        stepsByStage[etape] = [];
      }
      stepsByStage[etape].push(q);
    });

    const sortedStages = Object.keys(stepsByStage).sort((a, b) => parseInt(a) - parseInt(b));

    // Conserve les étapes initiales (intro, infos fournisseur/produit)
    // et ajoute les nouvelles étapes après celles-ci.
    // L'étape d'intro est data-step="1" (index 0)
    // L'étape infos est data-step="2" (index 1)
    // Les étapes dynamiques commenceront après l'index 1.

    // Définir le numéro d'étape visuel de départ pour les étapes dynamiques
    // Ceci doit correspondre au `data-step` des dernières étapes statiques
    let currentVisualStepNumber = 2;

    this.dynamicFormStepsContainer.innerHTML = ''; // Nettoyer le conteneur des étapes dynamiques

    sortedStages.forEach(stageNum => {
      const stageQuestions = stepsByStage[stageNum].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));

      const stepDiv = document.createElement('div');
      stepDiv.classList.add('form-step');
      stepDiv.dataset.step = ++currentVisualStepNumber; // Incrémente le numéro d'étape visuel
      stepDiv.innerHTML = `
        <div class="form-navigation">
          <button type="button" class="arrow-button prev-step">←</button>
          <h3>Étape ${currentVisualStepNumber - 1} : Questions sur l'impact</h3>
        </div>
        <div class="form-grid">
          ${stageQuestions.map(q => this.generateInputField(q)).join('')}
        </div>
        <p id="step${stepDiv.dataset.step}-status" class="form-status"></p>
        <button type="button" class="button next-step">SUIVANT</button>
      `;
      this.dynamicFormStepsContainer.appendChild(stepDiv);
    });

    // Mettre à jour la liste complète des étapes du formulaire après le rendu dynamique
    this.formSteps = Array.from(this.form.querySelectorAll('.form-step'));
    this.generateProgressBar(); // Régénérer la barre de progression avec toutes les étapes
    this.updateButtons(); // Ré-attacher les écouteurs d'événements aux nouveaux boutons
  }

  /**
   * Affiche l'étape du formulaire spécifiée par son index.
   * @param {number} stepIndex - L'index de l'étape à afficher.
   */
  showStep(stepIndex) {
    this.formSteps.forEach((step, index) => {
      if (index === stepIndex) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    });
    this.updateProgressBar(stepIndex);
    this.currentStepIndex = stepIndex;
    // Scrolle la vue vers le haut du formulaire pour la nouvelle étape
    this.form.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  /**
   * Met à jour l'affichage de la barre de progression.
   * @param {number} stepIndex - L'index de l'étape actuelle.
   */
  updateProgressBar(stepIndex) {
    if (!this.formProgressBarSteps.length) {
      // Si la barre de progression n'a pas encore été générée, ne rien faire
      return;
    }

    this.formProgressBarSteps.forEach((stepEl, index) => {
      if (index <= stepIndex) {
        stepEl.classList.add('active');
      } else {
        stepEl.classList.remove('active');
      }
    });

    this.progressSegments.forEach((segmentEl, index) => {
      if (index < stepIndex) {
        segmentEl.classList.add('active');
      } else {
        segmentEl.classList.remove('active');
      }
    });
  }

  /**
   * Valide les champs requis de l'étape actuelle.
   * @param {number} stepIndex - L'index de l'étape à valider.
   * @returns {boolean} - Vrai si l'étape est valide, faux sinon.
   */
  validateStep(stepIndex) {
    const currentFormStep = this.formSteps[stepIndex];
    // Les étapes 0 (intro) et finale n'ont pas de validation de champ direct
    if (stepIndex === 0 || currentFormStep.dataset.step === 'final') {
      return true;
    }

    const inputs = currentFormStep.querySelectorAll('input[required], textarea[required], select[required]');
    let isValid = true;

    // Effacer tous les messages d'erreur et styles d'erreur de l'étape actuelle
    currentFormStep.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    currentFormStep.querySelectorAll('.form-field-error-message').forEach(el => el.textContent = '');

    inputs.forEach(input => {
      const fieldContainer = input.closest('.form-field');
      const errorMessageEl = fieldContainer ? fieldContainer.querySelector('.form-field-error-message') : null;

      let fieldValid = true;
      let fieldErrorMessage = '';

      // Validation de base pour les champs texte, email, number, textarea, select
      if (input.type !== 'radio' && input.type !== 'checkbox') {
        if (!input.value.trim()) {
          fieldValid = false;
          fieldErrorMessage = 'Ce champ est requis.';
        } else if (input.type === 'email' && !this.isValidEmail(input.value)) {
          fieldValid = false;
          fieldErrorMessage = 'Veuillez entrer une adresse email valide.';
        } else if (input.name === 'siret_fournisseur' && input.value.trim() && !/^[0-9]{14}$/.test(input.value)) {
          fieldValid = false;
          fieldErrorMessage = 'Le numéro SIRET doit contenir 14 chiffres.';
        }
      }

      // Validation pour les groupes radio et checkbox
      if ((input.type === 'radio' || input.type === 'checkbox') && input.required) {
        const groupName = input.name;
        const groupInputs = currentFormStep.querySelectorAll(`input[name="${groupName}"]`);
        const isGroupChecked = Array.from(groupInputs).some(item => item.checked);

        if (!isGroupChecked) {
          fieldValid = false;
          fieldErrorMessage = 'Veuillez sélectionner au moins une option.';
          groupInputs.forEach(el => el.classList.add('is-invalid'));
        } else {
          groupInputs.forEach(el => el.classList.remove('is-invalid'));
        }
      }

      if (!fieldValid) {
        isValid = false;
        if (errorMessageEl) {
          errorMessageEl.textContent = fieldErrorMessage;
        }
        if (input.type !== 'radio' && input.type !== 'checkbox') {
          input.classList.add('is-invalid');
        }
      } else {
        if (input.type !== 'radio' && input.type !== 'checkbox') {
          input.classList.remove('is-invalid');
        }
      }
    });

    // Mise à jour du message de statut global de l'étape
    const stepStatusElement = currentFormStep.querySelector('.form-status');
    if (stepStatusElement) {
      if (!isValid) {
        stepStatusElement.textContent = 'Veuillez corriger les erreurs dans les champs requis.';
        stepStatusElement.className = 'form-status error';
      } else {
        stepStatusElement.textContent = '';
        stepStatusElement.className = '';
      }
    }
    return isValid;
  }

  /**
   * Vérifie si une chaîne de caractères est une adresse email valide.
   * @param {string} email - L'adresse email à valider.
   * @returns {boolean} - Vrai si l'email est valide, faux sinon.
   */
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /**
   * Collecte les données de l'étape actuelle et les ajoute à `formDataCollected`.
   * @param {number} stepIndex - L'index de l'étape à collecter.
   */
  collectDataForStep(stepIndex) {
    const currentFormStep = this.formSteps[stepIndex];
    const inputs = currentFormStep.querySelectorAll('input, textarea, select');

    // Initialiser/Vider les tableaux pour les groupes de checkboxes UNIQUEMENT pour l'étape actuelle
    const checkboxGroupNamesInStep = new Set();
    inputs.forEach(input => {
      if (input.type === 'checkbox' && input.name) {
        checkboxGroupNamesInStep.add(input.name);
      }
    });
    checkboxGroupNamesInStep.forEach(name => {
      this.formDataCollected[name] = [];
    });

    inputs.forEach(input => {
      if (!input.name || input.type === 'submit' || input.type === 'button') {
        return;
      }

      if (input.type === 'radio') {
        if (input.checked) {
          this.formDataCollected[input.name] = input.value.trim();
        }
      } else if (input.type === 'checkbox') {
        if (input.checked) {
          if (!this.formDataCollected[input.name]) {
            this.formDataCollected[input.name] = [];
          }
          this.formDataCollected[input.name].push(input.value.trim());
        }
      } else {
        this.formDataCollected[input.name] = input.value.trim();
      }
    });
    console.log('formDataCollected après collecte de l\'étape:', this.formDataCollected);
  }

  /**
   * Génère le résumé des données collectées avant la soumission finale.
   */
  generateSummary() {
    const formSummary = this.querySelector('#form-summary');
    if (!formSummary) {
      console.error("L'élément 'form-summary' n'est pas trouvé. Le résumé ne peut pas être généré.");
      return;
    }
    let summaryHTML = '';

    summaryHTML += `<h4>Informations Fournisseur</h4>`;
    if (this.formDataCollected.prenom_fournisseur) summaryHTML += `<p><strong>Prénom:</strong> ${this.formDataCollected.prenom_fournisseur}</p>`;
    if (this.formDataCollected.nom_fournisseur) summaryHTML += `<p><strong>Nom:</strong> ${this.formDataCollected.nom_fournisseur}</p>`;
    if (this.formDataCollected.email_fournisseur) summaryHTML += `<p><strong>Email:</strong> ${this.formDataCollected.email_fournisseur}</p>`;
    if (this.formDataCollected.entreprise_fournisseur) summaryHTML += `<p><strong>Entreprise:</strong> ${this.formDataCollected.entreprise_fournisseur}</p>`;
    if (this.formDataCollected.siret_fournisseur) summaryHTML += `<p><strong>SIRET:</strong> ${this.formDataCollected.siret_fournisseur}</p>`;

    summaryHTML += `<h4 style="margin-top: 20px;">Informations Produit</h4>`;
    if (this.formDataCollected.nom_produit) summaryHTML += `<p><strong>Nom du produit:</strong> ${this.formDataCollected.nom_produit}</p>`;
    if (this.formDataCollected.description_produit) summaryHTML += `<p><strong>Description du produit:</strong> ${this.formDataCollected.description_produit}</p>`;

    summaryHTML += `<h4 style="margin-top: 20px;">Questions sur l'impact (Dynamiques)</h4>`;
    this.dynamicQuestionsData.forEach(question => {
      const answerKey = question.indicateur_questions;
      let answerValue = this.formDataCollected[answerKey];

      if (answerValue === undefined || answerValue === null || answerValue === '') {
        answerValue = "Non renseigné";
      } else if (Array.isArray(answerValue)) {
        answerValue = answerValue.join(', ');
      }

      summaryHTML += `<p><strong>${question.titre}:</strong> ${answerValue}</p>`;
    });

    formSummary.innerHTML = summaryHTML;
  }

  /**
   * Génère la barre de progression du formulaire.
   */
  generateProgressBar() {
    if (!this.formProgressBar) {
      console.error("L'élément 'form-progress-bar' n'est pas trouvé. La barre de progression ne peut pas être générée.");
      return;
    }
    this.formProgressBar.innerHTML = '';
    const totalVisualSteps = this.formSteps.length;

    for (let i = 0; i < totalVisualSteps; i++) {
      const stepWrapper = document.createElement('div');
      stepWrapper.classList.add('step-wrapper');

      const stepDiv = document.createElement('div');
      stepDiv.classList.add('step');
      stepDiv.dataset.step = i + 1;
      stepDiv.textContent = i + 1;
      stepWrapper.appendChild(stepDiv);

      if (i < totalVisualSteps - 1) {
        const segmentDiv = document.createElement('div');
        segmentDiv.classList.add('progress-segment');
        segmentDiv.dataset.segment = i + 1;
        stepWrapper.appendChild(segmentDiv);
      }
      this.formProgressBar.appendChild(stepWrapper);
    }
    this.formProgressBarSteps = this.formProgressBar.querySelectorAll('.step');
    this.progressSegments = this.formProgressBar.querySelectorAll('.progress-segment');
  }

  /**
   * Met à jour les écouteurs d'événements pour les boutons de navigation (précédent/suivant).
   * Important d'appeler après le rendu des étapes dynamiques.
   */
  updateButtons() {
    // Supprimer tous les écouteurs existants pour éviter les duplications
    this.form.querySelectorAll('.next-step').forEach(button => button.removeEventListener('click', this.handleNextClick));
    this.form.querySelectorAll('.prev-step').forEach(button => button.removeEventListener('click', this.handlePrevClick));

    // Ré-attacher les écouteurs d'événements
    this.form.querySelectorAll('.next-step').forEach(button => {
      button.addEventListener('click', this.handleNextClick);
    });
    this.form.querySelectorAll('.prev-step').forEach(button => {
      button.addEventListener('click', this.handlePrevClick);
    });
  }

  /**
   * Gère le clic sur le bouton "SUIVANT".
   */
  handleNextClick() {
    if (this.validateStep(this.currentStepIndex)) {
      this.collectDataForStep(this.currentStepIndex);

      if (this.currentStepIndex + 1 < this.formSteps.length) {
        this.showStep(this.currentStepIndex + 1);
        if (this.formSteps[this.currentStepIndex].dataset.step === 'final') {
          this.generateSummary();
        }
      }
    }
  }

  /**
   * Gère le clic sur le bouton "PRÉCÉDENT".
   */
  handlePrevClick() {
    if (this.currentStepIndex > 0) {
      this.showStep(this.currentStepIndex - 1);
    }
  }

  /**
   * Gère la réinitialisation complète du formulaire.
   * @param {Event} event - L'événement de clic (optionnel).
   */
  resetForm(event) {
    if (event) event.preventDefault(); // Empêche le comportement par défaut du lien/bouton

    this.form.reset(); // Réinitialise les valeurs des champs HTML

    // Réinitialise l'objet formDataCollected
    for (const key in this.formDataCollected) {
      delete this.formDataCollected[key];
    }

    // Efface les messages de statut globaux et de chaque étape
    if (this.formStatusMain) {
      this.formStatusMain.textContent = '';
      this.formStatusMain.className = '';
    }
    this.formSteps.forEach(step => {
      const statusElement = step.querySelector('.form-status');
      if (statusElement) {
        statusElement.textContent = '';
        statusElement.className = '';
      }
      // Retirer les classes 'is-invalid' et les messages d'erreur des champs
      step.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
      step.querySelectorAll('.form-field-error-message').forEach(el => el.textContent = '');
    });

    // Efface et réinitialise les étapes dynamiques et la barre de progression
    this.dynamicFormStepsContainer.innerHTML = '';
    this.formSteps = Array.from(this.form.querySelectorAll('.form-step[data-step="1"], .form-step[data-step="2"], .form-step[data-step="final"]')); // Reset to only static steps
    this.generateProgressBar(); // Régénère la barre de progression pour les étapes statiques initiales
    this.questionsLoaded = false; // Permet de recharger les questions si le formulaire est réinitialisé

    this.showStep(0); // Retourne à la première étape
    this.updateButtons(); // Ré-attache les écouteurs pour les étapes statiques
    this.initializeForm(); // Relance le chargement des questions et la construction des étapes dynamiques
  }

  /**
   * Gère la soumission finale du formulaire.
   * @param {Event} event - L'événement de soumission.
   */
  async handleFormSubmit(event) {
    event.preventDefault();

    if (this.formStatusMain) {
      this.formStatusMain.textContent = 'Envoi en cours...';
      this.formStatusMain.className = 'form-status';
    }

    console.log('DEBUG CLIENT: Final formDataCollected being sent:', this.formDataCollected);
    console.log('DEBUG CLIENT: Final dynamicQuestionsData (definitions) being sent:', this.dynamicQuestionsData);

    try {
      const response = await fetch(this.sendFormDataNetlifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          formData: this.formDataCollected,
          dynamicQuestions: this.dynamicQuestionsData
        }),
      });

      const result = await response.json();

      if (response.ok) {
        if (this.formStatusMain) {
          this.formStatusMain.textContent = 'Formulaire soumis avec succès !';
          this.formStatusMain.className = 'form-status success';
        }
        // Réinitialiser le formulaire après succès
        this.resetForm();
        // Optionnel: afficher un message de remerciement final plus élaboré ou rediriger
      } else {
        if (this.formStatusMain) {
          this.formStatusMain.textContent = `Erreur lors de la soumission: ${result.message || 'Une erreur inconnue est survenue.'}`;
          this.formStatusMain.className = 'form-status error';
        }
      }
    } catch (error) {
      console.error('Erreur réseau ou inattendue lors de la soumission:', error);
      if (this.formStatusMain) {
        this.formStatusMain.textContent = `Erreur: Impossible de communiquer avec le serveur. ${error.message}`;
        this.formStatusMain.className = 'form-status error';
      }
    }
  }
}

// Définition de l'élément personnalisé.
// Cette ligne doit être présente dans votre fichier JavaScript.
customElements.define('formulaire-lowreka', FormulaireLowreka);